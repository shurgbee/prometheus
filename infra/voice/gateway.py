"""Private, single-worker SIP/WAV gateway. Persists each physical dial by caller-supplied key."""
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
import hashlib
import hmac
import io
import json
import logging
import os
from pathlib import Path
import sqlite3
import time
import wave
from zoneinfo import ZoneInfo

import aiohttp
from fastapi import Depends, FastAPI, Header, HTTPException, Response
from google.protobuf.duration_pb2 import Duration
import httpx
from livekit import api, rtc
from pydantic import BaseModel, Field

log = logging.getLogger("voice")
DATA = Path(os.getenv("VOICE_DATA", "/data"))
DATA.mkdir(parents=True, exist_ok=True)
TOKEN = os.environ["NOTIFIER_TOKEN"]
TERMINAL = {"completed", "missed", "failed", "interrupted"}
tasks = {}
slots = asyncio.Semaphore(2)
tts_lock = asyncio.Lock()


def connect():
    db = sqlite3.connect(DATA / "calls.sqlite")
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("""CREATE TABLE IF NOT EXISTS calls (
      key TEXT PRIMARY KEY, payload TEXT NOT NULL, room TEXT NOT NULL, status TEXT NOT NULL,
      error TEXT, sip_code TEXT, created REAL NOT NULL, dialed REAL, updated REAL NOT NULL)""")
    if "is_test" not in {column[1] for column in db.execute("PRAGMA table_info(calls)")}:
        db.execute("ALTER TABLE calls ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0")
        db.commit()
    return db


def row(key):
    with connect() as db:
        found = db.execute("SELECT * FROM calls WHERE key=?", (key,)).fetchone()
        return dict(found) if found else None


def update(key, status, error=None, sip_code=None):
    with connect() as db:
        db.execute("UPDATE calls SET status=?,error=?,sip_code=?,updated=? WHERE key=?",
                   (status, error, sip_code, time.time(), key))


class DailyCallLimit(RuntimeError):
    pass


def call_budget(db=None):
    zone = ZoneInfo(os.getenv("VOICE_TIMEZONE", "America/Chicago"))
    midnight = datetime.now(zone).replace(hour=0, minute=0, second=0, microsecond=0)
    if db is None:
        with connect() as connection:
            return call_budget(connection)
    count = db.execute("SELECT count(*) FROM calls WHERE dialed>=? AND is_test=0", (midnight.timestamp(),)).fetchone()[0]
    tests = db.execute("SELECT count(*) FROM calls WHERE dialed>=? AND is_test=1", (midnight.timestamp(),)).fetchone()[0]
    limit = int(os.getenv("MAX_CALLS_PER_DAY", "3"))
    return {"used": count, "limit": limit, "remaining": max(0, limit - count),
            "resets_at": (midnight + timedelta(days=1)).isoformat(), "timezone": str(zone), "test_calls": tests}


def require_call_budget(db=None):
    budget = call_budget(db)
    if not budget["remaining"]:
        raise DailyCallLimit(f"Daily physical-call limit reached ({budget['used']}/{budget['limit']}); "
                            f"resets at midnight {budget['timezone']}")


def reserve_dial(key):
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        job = db.execute("SELECT is_test FROM calls WHERE key=?", (key,)).fetchone()
        if job is None:
            raise ValueError("Unknown call")
        if not job["is_test"]:
            require_call_budget(db)
        db.execute("UPDATE calls SET status='dialing',dialed=?,updated=? WHERE key=?",
                   (time.time(), time.time(), key))


def client():
    return api.LiveKitAPI(url=os.getenv("LIVEKIT_URL", "ws://127.0.0.1:7880"),
                         api_key=os.environ["LIVEKIT_API_KEY"], api_secret=os.environ["LIVEKIT_API_SECRET"],
                         timeout=aiohttp.ClientTimeout(total=75))


def voice_line():
    return os.getenv("VOICE_PHOTON_LINE") or os.environ["PHOTON_LINE"]


async def trunk(lk):
    saved = DATA / "trunk.json"
    response = await lk.sip.list_sip_outbound_trunk(api.ListSIPOutboundTrunkRequest())
    name = "prometheus-photon-outbound"
    found = next((t for t in response.items if t.name == name), None)
    if found is None:
        found = await lk.sip.create_sip_outbound_trunk(api.CreateSIPOutboundTrunkRequest(
            trunk=api.SIPOutboundTrunkInfo(name=name, address=os.environ["PHOTON_SIP_ADDRESS"],
                numbers=[voice_line()], transport=api.SIP_TRANSPORT_TLS,
                auth_username=os.environ["PHOTON_SIP_USERNAME"], auth_password=os.environ["PHOTON_SIP_PASSWORD"],
                media_encryption=api.SIP_MEDIA_ENCRYPT_ALLOW)))
    saved.write_text(json.dumps({"id": found.sip_trunk_id}))
    return found.sip_trunk_id


async def synthesize(text):
    async with tts_lock:
        return await render_wav(text)


async def render_wav(text):
    digest = hashlib.sha256((os.getenv("RIVA_VOICE", "Magpie-Multilingual.EN-US.Aria") + text).encode()).hexdigest()
    target = DATA / (digest + ".wav")
    if not target.exists():
        async with httpx.AsyncClient(timeout=35) as http:
            response = await http.post(os.getenv("RIVA_URL", "http://127.0.0.1:9000") + "/v1/audio/synthesize",
                files={key: (None, value) for key, value in {
                    "language": "en-US", "voice": os.getenv("RIVA_VOICE", "Magpie-Multilingual.EN-US.Aria"),
                    "text": text}.items()})
            response.raise_for_status()
        # Riva versions can return different sample rates; always normalize before RTC publication.
        process = await asyncio.create_subprocess_exec("ffmpeg", "-v", "error", "-i", "pipe:0",
            "-f", "wav", "-acodec", "pcm_s16le", "-ar", "48000", "-ac", "1", "pipe:1",
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        result, _ = await process.communicate(response.content)
        if process.returncode:
            raise RuntimeError("TTS did not return decodable audio")
        with wave.open(io.BytesIO(result)) as audio:
            pcm = audio.readframes(48000 * 40 + 1)
        if not pcm or len(pcm) > 48000 * 40 * 2:
            raise RuntimeError("Announcement must be between zero and 40 seconds")
        temp = target.with_suffix(".tmp")
        with wave.open(str(temp), "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(48000)
            audio.writeframes(pcm)
        temp.replace(target)
    return target


def enqueue(key):
    if key in tasks:
        return
    task = asyncio.create_task(run(key))
    tasks[key] = task
    task.add_done_callback(lambda _: tasks.pop(key, None))


async def run(key):
    async with slots:
        job = row(key)
        if not job or job["status"] in TERMINAL:
            return
        # Reject exhausted days before creating media sessions; reserve atomically again at dial time.
        try:
            if not job["is_test"]:
                require_call_budget()
        except DailyCallLimit as error:
            update(key, "failed", str(error))
            return
        payload = json.loads(job["payload"])
        room = rtc.Room()
        hung_up = asyncio.Event()
        lk = client()

        @room.on("participant_disconnected")
        def disconnected(participant):
            if participant.identity == "recipient":
                hung_up.set()

        try:
            update(key, "rendering")
            wav_path = await synthesize(payload["script"])
            trunk_id = await trunk(lk)
            jwt = (api.AccessToken(os.environ["LIVEKIT_API_KEY"], os.environ["LIVEKIT_API_SECRET"])
                   .with_identity("announcement").with_grants(api.VideoGrants(room_join=True, room=job["room"]))
                   .to_jwt())
            await room.connect(os.getenv("LIVEKIT_URL", "ws://127.0.0.1:7880"), jwt)
            source = rtc.AudioSource(48000, 1)
            track = rtc.LocalAudioTrack.create_audio_track("alert-announcement", source)
            publication = await room.local_participant.publish_track(track,
                rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE))
            reserve_dial(key)
            await lk.sip.create_sip_participant(api.CreateSIPParticipantRequest(
                sip_trunk_id=trunk_id, sip_call_to=payload["phone"], room_name=job["room"],
                participant_identity="recipient", wait_until_answered=True,
                ringing_timeout=Duration(seconds=35), max_call_duration=Duration(seconds=90)))
            await asyncio.wait_for(publication.wait_for_subscription(), timeout=10)
            update(key, "playing")
            # A little silence gives the phone's audio route time to settle after answer.
            await asyncio.sleep(0.7)
            with wave.open(str(wav_path)) as audio:
                while chunk := audio.readframes(960):
                    if hung_up.is_set():
                        update(key, "interrupted", "Call ended before playback completed")
                        return
                    await source.capture_frame(rtc.AudioFrame(data=chunk, sample_rate=48000,
                        num_channels=1, samples_per_channel=len(chunk) // 2))
            await source.wait_for_playout()
            if hung_up.is_set():
                update(key, "interrupted", "Call ended during playback")
            else:
                update(key, "completed")
                await asyncio.sleep(0.5)
        except api.TwirpError as error:
            code = str(error.metadata.get("sip_status_code", ""))
            # Only actual unavailable/busy/no-answer outcomes authorize the missed-call retry.
            missed = code in {"408", "480", "486", "487", "600", "603"}
            message = ("Photon rejected SIP call (403 Forbidden); check the current outbound credential "
                       "and provider voice permissions" if code == "403" else f"SIP call failed ({code or error.code})")
            update(key, "missed" if missed else "failed", message, code)
        except DailyCallLimit as error:
            update(key, "failed", str(error))
        except Exception as error:
            log.error("Voice job %s failed: %s", key, type(error).__name__)
            update(key, "failed", f"Voice operation failed: {type(error).__name__}")
        finally:
            try:
                await lk.room.delete_room(api.DeleteRoomRequest(room=job["room"]))
            except Exception:
                pass
            await room.disconnect()
            await lk.aclose()


@asynccontextmanager
async def lifespan(app):
    # Never redial an ambiguous in-flight call following a process crash.
    with connect() as db:
        unfinished = [dict(r) for r in db.execute("SELECT * FROM calls WHERE status NOT IN ('completed','missed','failed','interrupted')")]
    lk = client()
    for job in unfinished:
        if job["status"] == "queued":
            enqueue(job["key"])
        else:
            try:
                await lk.room.delete_room(api.DeleteRoomRequest(room=job["room"]))
            except Exception:
                pass
            update(job["key"], "failed", "Gateway restarted; uncertain attempt was not redialed")
    await lk.aclose()
    yield
    for task in list(tasks.values()):
        task.cancel()
    await asyncio.gather(*list(tasks.values()), return_exceptions=True)


app = FastAPI(lifespan=lifespan)


def authorized(authorization: str = Header(default="")):
    if not hmac.compare_digest(authorization, "Bearer " + TOKEN):
        raise HTTPException(401, "Invalid notifier token")


class CallInput(BaseModel):
    key: str = Field(min_length=1, max_length=220, pattern=r"^[A-Za-z0-9:_-]+$")
    phone: str = Field(pattern=r"^\+[1-9]\d{6,14}$")
    script: str = Field(min_length=1, max_length=600)
    test_call: bool = Field(default=False, strict=True)


class RenderInput(BaseModel):
    script: str = Field(min_length=1, max_length=600)


def public(job):
    return {**{k: job[k] for k in ["key", "status", "error", "sip_code", "updated"]},
            "test_call": bool(job["is_test"])}


@app.get("/healthz", dependencies=[Depends(authorized)])
async def health():
    async with httpx.AsyncClient(timeout=5) as http:
        try:
            response = await http.get(os.getenv("RIVA_URL", "http://127.0.0.1:9000") + "/v1/health/ready")
            tts = response.is_success
        except httpx.HTTPError:
            tts = False
    lk = client()
    try:
        await lk.room.list_rooms(api.ListRoomsRequest())
        livekit = True
    except Exception:
        livekit = False
    finally:
        await lk.aclose()
    return {"ok": tts and livekit, "tts": tts, "livekit": livekit, "call_budget": call_budget()}


@app.post("/render", dependencies=[Depends(authorized)])
async def render(data: RenderInput):
    target = await synthesize(data.script)
    return Response(target.read_bytes(), media_type="audio/wav")


@app.post("/calls", dependencies=[Depends(authorized)], status_code=202)
async def create(data: CallInput):
    if data.phone == voice_line():
        raise HTTPException(422, "Recipient cannot be the originating Photon line")
    if data.phone != os.environ["ALERT_PHONE"]:
        raise HTTPException(422, "Recipient must match configured ALERT_PHONE")
    payload = data.model_dump_json(exclude={"key"})
    with connect() as db:
        db.execute("INSERT OR IGNORE INTO calls(key,payload,room,status,created,updated,is_test) VALUES(?,?,?,'queued',?,?,?)",
            (data.key, payload, "alert-" + hashlib.sha256(data.key.encode()).hexdigest()[:24],
             time.time(), time.time(), int(data.test_call)))
    job = row(data.key)
    # Older rows lack the flag in their JSON; the migrated column remains authoritative.
    if {**json.loads(job["payload"]), "test_call": bool(job["is_test"])} != json.loads(payload):
        raise HTTPException(409, "Idempotency key was already used with a different payload")
    if job["status"] not in TERMINAL:
        enqueue(data.key)
    return public(job)


@app.get("/calls/{key}", dependencies=[Depends(authorized)])
async def get(key: str):
    job = row(key)
    if not job:
        raise HTTPException(404, "Unknown call")
    return public(job)
