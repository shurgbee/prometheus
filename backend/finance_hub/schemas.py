import re
from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator

Ticker = Annotated[str, Field(pattern=r"^[A-Z][A-Z0-9.\-]{0,14}$")]
Duration = Annotated[str, Field(pattern=r"^[1-9][0-9]{0,4}[mhd]$")]


def seconds(duration):
    return int(duration[:-1]) * {"m": 60, "h": 3600, "d": 86400}[duration[-1]]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class HoldingInput(StrictModel):
    asset_class: Literal["cash", "cd", "stock"]
    name: str = Field(min_length=1, max_length=200)
    ticker: Ticker | None = None
    quantity: float | None = Field(default=None, ge=0)
    cost_basis: float | None = Field(default=None, ge=0)  # Total position cost, not per-share price.
    principal: float | None = Field(default=None, ge=0)  # Cash balance or CD principal.
    apy: float | None = Field(default=None, ge=0, le=1)  # Fraction, e.g. .045.
    start_date: date | None = None
    maturity_date: date | None = None

    @field_validator("ticker", mode="before")
    @classmethod
    def upper_ticker(cls, v):
        return v.upper().strip() if v else None

    @model_validator(mode="after")
    def fields_for_asset(self):
        if self.asset_class == "stock" and (not self.ticker or self.quantity is None or self.cost_basis is None):
            raise ValueError("Stocks require ticker, quantity and total cost_basis")
        if self.asset_class in ("cash", "cd") and self.principal is None:
            raise ValueError("Cash/CDs require principal (cash balance)")
        if self.asset_class == "cd":
            if self.apy is None or not self.start_date or not self.maturity_date:
                raise ValueError("CDs require apy, start_date and maturity_date")
            if self.maturity_date < self.start_date:
                raise ValueError("maturity_date must be on or after start_date")
        return self


class SignalSpec(StrictModel):
    source: Literal["price", "news", "event"]
    query: str = Field(min_length=1, max_length=500)
    detector: Literal["daily_change", "price_level", "text_event", "event_occurs"]
    params: dict = Field(default_factory=dict)
    poll: Duration = "5m"

    @model_validator(mode="after")
    def supported_detector(self):
        if (self.source, self.detector) not in (("price", "daily_change"), ("price", "price_level"),
                                                ("news", "text_event"), ("event", "event_occurs")):
            raise ValueError("Unsupported source and detector combination")
        if seconds(self.poll) < (60 if self.source == "price" else 300):
            raise ValueError("Minimum price poll is 1m; news poll is 5m")
        # Crypto quotes use an EXCHANGE:PAIR symbol, such as BINANCE:BTCUSDT.
        if self.source == "price" and not re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,14}|[A-Z]{2,20}:[A-Z0-9\-]{2,20}", self.query):
            raise ValueError("Price query must be one uppercase ticker")
        if self.detector == "price_level":
            level = self.params.get("level")
            if isinstance(level, bool) or not isinstance(level, (int, float)) or level <= 0:
                raise ValueError("price_level requires a positive level")
            if self.params.get("direction") not in ("above", "below"):
                raise ValueError("price_level direction must be above or below")
        if self.detector == "event_occurs":
            condition = self.params.get("condition")
            if not isinstance(condition, str) or not condition.strip() or len(condition) > 500:
                raise ValueError("event_occurs requires a condition")
            if "deadline" in self.params:
                try:
                    date.fromisoformat(self.params["deadline"])
                except (TypeError, ValueError):
                    raise ValueError("deadline must be an ISO date") from None
        unknown = set(self.params) - {"threshold_percent", "keywords", "level", "direction", "condition", "deadline"}
        if unknown:
            raise ValueError("Unknown detector params")
        threshold = self.params.get("threshold_percent", 3)
        if not isinstance(threshold, (int, float)) or not 0.1 <= threshold <= 100:
            raise ValueError("threshold_percent must be between .1 and 100")
        keywords = self.params.get("keywords", [])
        if not isinstance(keywords, list) or not all(isinstance(x, str) and x.strip() for x in keywords):
            raise ValueError("keywords must be a list of nonempty strings")
        return self


class Cooldown(StrictModel):
    normal: Duration = "30m"
    critical: Duration = "30m"


class TriggerSpec(StrictModel):
    name: str = Field(min_length=1, max_length=200)
    entity: str = Field(min_length=1, max_length=200)
    tickers: list[Ticker] = Field(max_length=10)
    hypothesis: str = Field(min_length=1, max_length=1000)
    signals: list[SignalSpec] = Field(min_length=1, max_length=10)
    critical_capable: bool = False
    pinned: bool = False
    cooldown: Cooldown = Field(default_factory=Cooldown)

    @model_validator(mode="after")
    def tickers_unless_market_wide_event(self):
        # An event like a Fed decision isn't tied to one company.
        if not self.tickers and any(s.detector != "event_occurs" for s in self.signals):
            raise ValueError("At least one ticker is required")
        return self


class TriggerCreate(StrictModel):
    spec: TriggerSpec
    approved: Literal[True]  # Explicit user action; never an advisor tool input.


class TriggerPatch(StrictModel):
    spec: TriggerSpec | None = None
    status: Literal["active", "paused"] | None = None
    approved: Literal[True]


class ChatInput(StrictModel):
    message: str = Field(min_length=1, max_length=6000)
    thread_id: str | None = Field(default=None, min_length=1, max_length=128, pattern=r"^[\w-]+$")


class Decision(StrictModel):
    proposal_id: str
    action: Literal["approve", "edit", "reject"]
    spec: TriggerSpec | None = None

    @model_validator(mode="after")
    def edit_requires_spec(self):
        if self.action == "edit" and not self.spec:
            raise ValueError("Edit requires a complete spec")
        if self.action != "edit" and self.spec:
            raise ValueError("spec is only accepted for edit")
        return self


class ResumeInput(StrictModel):
    decisions: list[Decision] = Field(min_length=1, max_length=10)


class ResearchInput(StrictModel):
    topic: str = Field(min_length=1, max_length=1000)
    questions: list[str] = Field(default_factory=list, max_length=6)
    tickers: list[Ticker] = Field(default_factory=list, max_length=10)
    thread_id: str | None = Field(default=None, max_length=128)


class InjectSignal(StrictModel):
    trigger_id: str
    source: Literal["news", "price", "sec_edgar", "nhtsa"] = "news"
    external_id: str = Field(min_length=1, max_length=200)
    title: str = Field(min_length=1, max_length=1000)
    url: HttpUrl
    magnitude: float = Field(ge=0, le=1)
    urgency: float = Field(default=0.7, ge=0, le=1)
    adjustment: float = Field(default=0, ge=-15, le=15)


class Triage(StrictModel):
    urgency: float = Field(ge=0, le=1)
    adjustment: float = Field(default=0, ge=-15, le=15)
    summary: str = Field(min_length=1, max_length=280)
    rationale: str = Field(min_length=1, max_length=2000)
    evidence_urls: list[str] = Field(default_factory=list, max_length=25)


class DeliveryUpdate(StrictModel):
    status: Literal["sent", "delivered", "failed", "calling", "missed", "acknowledged", "text_fallback"]
