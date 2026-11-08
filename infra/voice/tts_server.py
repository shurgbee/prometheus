"""Self-hosted GPU Kokoro with the small subset of Riva's HTTP interface we use."""
from contextlib import asynccontextmanager
import io
from threading import Lock

from fastapi import FastAPI, Form, HTTPException, Response
from kokoro import KPipeline
import numpy as np
import soundfile as sf
import torch

pipeline = None
lock = Lock()


@asynccontextmanager
async def lifespan(app):
    global pipeline
    torch.set_num_threads(4)
    pipeline = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M", device="cuda")
    # Download the selected voice and initialize kernels before advertising readiness.
    list(pipeline("Finance Hub is ready.", voice="af_heart"))
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/v1/health/ready")
def ready():
    return {"status": "ready", "engine": "kokoro", "device": "cuda", "voice": "af_heart"}


@app.get("/v1/audio/list_voices")
def voices():
    return {"en-US": {"voices": ["af_heart"]}}


@app.post("/v1/audio/synthesize")
def synthesize(text: str = Form(...), language: str = Form("en-US"), voice: str = Form("af_heart")):
    if len(text) > 600 or not text.strip():
        raise HTTPException(422, "Text must contain 1–600 characters")
    if language != "en-US":
        raise HTTPException(422, "This service is configured for en-US")
    # Riva voice names map to the configured Kokoro voice when switching engines.
    if voice not in {"af_heart", "Magpie-Multilingual.EN-US.Aria"}:
        raise HTTPException(422, "Unsupported voice")
    with lock:
        chunks = [audio.detach().cpu().numpy() if torch.is_tensor(audio) else audio
                  for _, _, audio in pipeline(text, voice="af_heart", speed=1.05)]
    if not chunks:
        raise HTTPException(502, "TTS generated no audio")
    output = io.BytesIO()
    sf.write(output, np.concatenate(chunks), 24000, format="WAV", subtype="PCM_16")
    return Response(output.getvalue(), media_type="audio/wav")
