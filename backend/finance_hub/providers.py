"""External calls stay here. Demo mode never silently substitutes for live failures."""
import asyncio
import hashlib
import json
import math
import re
from datetime import timedelta
from urllib.parse import urlparse

import httpx
from sqlalchemy import select

from .db import Holding, Price, aware, now, row_dict

DEMO_PRICES = {"TSLA": 250.0, "AAPL": 200.0, "MSFT": 420.0, "NVDA": 140.0, "GOOGL": 180.0, "AMZN": 210.0}
DISCLAIMER = "Educational, not financial advice."


class ProviderError(RuntimeError):
    pass


def safe_url(value):
    parsed = urlparse(value)
    return parsed.scheme in ("https", "http") and bool(parsed.hostname)


NUMBER = re.compile(r"(?<![\w.])[-+]?\d+(?:,\d{3})*(?:\.\d+)?(?![\w])")
# Dates/times and link targets are not figures; tokenizing them yields fragments like "-05".
NOT_FIGURES = re.compile(r"\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?"
                         r"|\]\([^)]*\)|https?://\S+")
LIST_MARKER = re.compile(r"^\s*\d+[.)]\s", re.M)
SMALL_COUNT = 12  # counts and ordinals ("2 CDs", "step 3") are not checkable figures


def numeric_flags(answer, context):
    """Conservative flagger: permits only numbers whose value appears in this turn's tool context.

    A number in the answer matches a context value when it equals that value, or that value
    times 100 (fractions shown as percents), rounded to the answer's own precision. Sign and
    thousands separators are ignored, so "$30,000.00", "4.50%" and "+0.36" match 30000.0, 0.045
    and 0.36. Derived arithmetic the model performs itself is still flagged.
    """
    def figures(text):
        for token in NUMBER.findall(NOT_FIGURES.sub(" ", text)):
            digits = token.lstrip("+-").replace(",", "")
            yield token, float(digits), len(digits.partition(".")[2])

    known = {value for _, value, _ in figures(json.dumps(context, default=str))}
    flags = set()
    for token, value, decimals in figures(LIST_MARKER.sub(" ", answer)):
        if decimals == 0 and value <= SMALL_COUNT:
            continue
        if not any(round(k, decimals) == value or round(k * 100, decimals) == value for k in known):
            flags.add(token)
    return sorted(flags)


class Providers:
    def __init__(self, settings, db):
        self.settings = settings
        self.db = db
        self.http = httpx.AsyncClient(timeout=httpx.Timeout(90, connect=10), follow_redirects=False)
        self.market_lock = asyncio.Lock()
        self.next_market_request = 0.0
        self.news_cache = {}

    async def close(self):
        await self.http.aclose()

    async def _request(self, method, url, **kwargs):
        for attempt in range(3):
            try:
                response = await self.http.request(method, url, **kwargs)
            except httpx.HTTPError:
                if attempt == 2:
                    raise ProviderError("External service connection failed") from None
                await asyncio.sleep(0.5 * (2 ** attempt))
                continue
            if response.status_code in (429, 502, 503, 504) and attempt < 2:
                try:
                    delay = float(response.headers.get("Retry-After", "1"))
                except ValueError:
                    delay = 1
                await asyncio.sleep(delay if math.isfinite(delay) and 0 <= delay <= 5 else 1)
                continue
            if response.is_error:
                # Never leak API keys in request URLs or provider error bodies to clients/logs.
                raise ProviderError(f"External service returned HTTP {response.status_code}")
            return response.json()
        raise ProviderError("External service unavailable")

    async def market(self, path, params):
        # Serialize Finnhub calls to stay below the documented free-tier per-second limit.
        async with self.market_lock:
            loop = asyncio.get_running_loop()
            await asyncio.sleep(max(0, self.next_market_request - loop.time()))
            self.next_market_request = loop.time() + 1.05
            return await self._request("GET", f"https://finnhub.io/api/v1/{path}",
                                       params=params, headers={"X-Finnhub-Token": self.settings.finnhub_api_key})

    async def quote(self, ticker, refresh=True):
        async with self.db.sessions() as session:
            cached = await session.scalar(select(Price).where(Price.ticker == ticker)
                                          .order_by(Price.ts.desc()).limit(1))
        if cached and (not refresh or (now() - aware(cached.fetched_at)).total_seconds() < 60):
            return row_dict(cached)
        if self.settings.demo_mode:
            price = DEMO_PRICES.get(ticker)
            if price is None:
                raise ProviderError(f"No demo quote for {ticker}; use a fixture ticker or configure live mode")
            data = {"price": price, "previous_close": price, "change_percent": 0.0, "demo": True, "ts": now()}
        else:
            raw = await self.market("quote", {"symbol": ticker})
            if (not raw.get("c") or not raw.get("t")
                    or not math.isfinite(float(raw["c"])) or float(raw["c"]) <= 0):
                raise ProviderError(f"No quote available for {ticker}")
            from datetime import datetime, timezone
            data = {"price": float(raw["c"]), "previous_close": raw.get("pc"),
                    "change_percent": raw.get("dp"), "demo": False,
                    "ts": datetime.fromtimestamp(raw["t"], timezone.utc)}
        from sqlalchemy.dialects.postgresql import insert as pg_insert
        from sqlalchemy.dialects.sqlite import insert as sqlite_insert
        async with self.db.sessions() as session:
            insert = pg_insert if self.db.is_postgres else sqlite_insert
            statement = insert(Price).values(ticker=ticker, fetched_at=now(), **data)
            statement = statement.on_conflict_do_update(index_elements=["ticker", "ts"],
                set_={"fetched_at": now(), "price": data["price"], "previous_close": data["previous_close"],
                      "change_percent": data["change_percent"]})
            await session.execute(statement)
            await session.commit()
            item = await session.get(Price, (ticker, data["ts"]))
        return row_dict(item)

    async def news(self, tickers, days=30):
        if self.settings.demo_mode:
            return [{"url": "https://www.nhtsa.gov/recalls", "publisher": "NHTSA",
                     "published_at": now().date().isoformat(), "ticker": ticker,
                     "title": f"DEMO: {ticker} recall monitoring example",
                     "excerpt": "Synthetic demo evidence: vehicle recalls, EV policy incentives and subsidies, "
                                "deliveries and regulatory filings are research themes; no current event is asserted."}
                    for ticker in tickers[:5]]
        results = []
        for ticker in list(dict.fromkeys(tickers))[:5]:
            key = (ticker, days)
            cached = self.news_cache.get(key)
            if cached and (now() - cached[0]).total_seconds() < 300:
                results.extend(cached[1])
                continue
            raw = await self.market("company-news", {"symbol": ticker, "from": (now() - timedelta(days=days))
                                                    .date().isoformat(), "to": now().date().isoformat()})
            items = [{"url": n["url"], "publisher": n.get("source", "Unknown"),
                      "published_at": str(n.get("datetime", "")), "ticker": ticker,
                      "external_id": str(n.get("id", n["url"])), "title": n.get("headline", ""),
                      "excerpt": n.get("summary", "")[:450]} for n in raw[:25] if safe_url(n.get("url", ""))]
            self.news_cache[key] = (now(), items)
            results.extend(items)
        return results[:25]

    async def chat(self, role, system, payload, json_output=False):
        if self.settings.demo_mode:
            raise ProviderError("Demo model responses are produced by the graph, not external APIs")
        base = getattr(self.settings, f"{role}_base_url")
        key = getattr(self.settings, f"{role}_api_key") or self.settings.nvidia_api_key
        body = {"model": getattr(self.settings, f"{role}_model"), "temperature": 0.2,
                "max_tokens": 4096, "messages": [{"role": "system", "content": system},
                                                 {"role": "user", "content": json.dumps(payload, default=str)}]}
        if json_output:
            body["response_format"] = {"type": "json_object"}
        raw = await self._request("POST", base.rstrip("/") + "/chat/completions", json=body,
                                  headers={"Authorization": f"Bearer {key}"})
        try:
            content = raw["choices"][0]["message"]["content"]
            return json.loads(content) if json_output else content
        except (KeyError, IndexError, TypeError, json.JSONDecodeError):
            raise ProviderError("Model returned an invalid response") from None

    @property
    def embedding_model(self):
        return "demo-hash-v1" if self.settings.demo_mode else self.settings.embed_model

    async def embed(self, texts, query=False):
        dimensions = self.settings.embed_dimensions
        if self.settings.demo_mode:
            vectors = []
            for text in texts:
                vector = [0.0] * dimensions
                text = re.sub(r"subsid\w*|incentive\w*|tax credit\w*", "evpolicy", text.lower())
                text = re.sub(r"electric vehicle\w*|\bev\b|tesla", "electricvehicle", text)
                for token in re.findall(r"\w+", text):
                    digest = hashlib.sha256(token.encode()).digest()
                    vector[int.from_bytes(digest[:4], "big") % dimensions] += 1 if digest[4] % 2 else -1
                norm = math.sqrt(sum(v*v for v in vector)) or 1
                vectors.append([v / norm for v in vector])
            return vectors
        result = await self._request(
            "POST", self.settings.embed_base_url.rstrip("/") + "/embeddings",
            headers={"Authorization": f"Bearer {self.settings.embed_api_key or self.settings.nvidia_api_key}"},
            json={"model": self.settings.embed_model, "input": texts,
                  "input_type": "query" if query else "passage", "encoding_format": "float", "truncate": "END"})
        try:
            vectors = [item["embedding"] for item in sorted(result["data"], key=lambda x: x["index"])]
            if len(vectors) != len(texts) or any(len(v) != dimensions for v in vectors):
                raise ValueError
            if any(not all(math.isfinite(x) for x in v) for v in vectors):
                raise ValueError
            return vectors
        except (KeyError, TypeError, ValueError):
            raise ProviderError("Embedding dimensions do not match EMBED_DIMENSIONS") from None

    async def context_tickers(self, topic):
        if self.settings.demo_mode:
            words = topic.lower()
            if any(x in words for x in ("tesla", "ev ", "electric", "auto", "subsid")):
                return ["TSLA"]
            return [t for t in DEMO_PRICES if t.lower() in words]
        raw = await self.chat("nano", "Return JSON {tickers: string[]} with at most 5 US stock ticker symbols "
                              "relevant to the user's topic. Do not give advice. An empty array is valid.",
                              {"topic": topic}, True)
        return list(dict.fromkeys(t for t in raw.get("tickers", []) if isinstance(t, str)
                                 and re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,14}", t)))[:5]

    async def watched_tickers(self):
        from .db import Trigger
        async with self.db.sessions() as session:
            holdings = (await session.scalars(select(Holding))).all()
            triggers = (await session.scalars(select(Trigger).where(Trigger.status == "active"))).all()
        return sorted({h.data["ticker"] for h in holdings if h.data.get("ticker")}
                      | {t for trigger in triggers for t in trigger.spec["tickers"]})
