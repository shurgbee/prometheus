import asyncio
from datetime import date

from sqlalchemy import select

from .db import Holding, aware, now
from .policy import cd_value


async def portfolio(db, providers, refresh=True):
    async with db.sessions() as session:
        holdings = (await session.scalars(select(Holding))).all()
    tickers = sorted({h.data["ticker"] for h in holdings if h.data["asset_class"] == "stock"})
    results = await asyncio.gather(*(providers.quote(t, refresh=refresh) for t in tickers), return_exceptions=True)
    quotes, warnings = {}, []
    for ticker, result in zip(tickers, results, strict=True):
        if isinstance(result, Exception):
            cached = None
            # A failed live refresh must not turn a position into a zero-valued asset.
            if cached is None:
                async with db.sessions() as session:
                    from .db import Price, row_dict
                    latest = await session.scalar(select(Price).where(Price.ticker == ticker)
                                                  .order_by(Price.ts.desc()).limit(1))
                    cached = row_dict(latest) if latest else None
            if cached:
                quotes[ticker] = cached
            warnings.append(f"{ticker}: quote unavailable or stale")
        else:
            quotes[ticker] = result
    allocation = {"cash": 0.0, "cd": 0.0, "stocks": 0.0}
    previous_total = 0.0
    complete = True
    rows = []
    for holding in holdings:
        data = dict(holding.data)
        asset = data["asset_class"]
        item = {"id": holding.id, **data}
        previous = None
        if asset == "cash":
            value = previous = data["principal"]
        elif asset == "cd":
            start, maturity = date.fromisoformat(data["start_date"]), date.fromisoformat(data["maturity_date"])
            elapsed = max(0, (min(now().date(), maturity) - start).days)
            value = cd_value(data["principal"], data["apy"], elapsed)
            previous = cd_value(data["principal"], data["apy"], elapsed - 1)
            item["days_to_maturity"] = max(0, (maturity - now().date()).days)
        else:
            quote = quotes.get(data["ticker"])
            value = data["quantity"] * quote["price"] if quote else None
            previous = data["quantity"] * quote["previous_close"] if quote and quote["previous_close"] else None
            item.update({"price": quote["price"] if quote else None, "quote_ts": quote["ts"] if quote else None,
                         "stale": not quote or (now() - aware(quote["ts"])).total_seconds() > 300,
                         "demo": quote["demo"] if quote else providers.settings.demo_mode})
            item["gain"] = value - data["cost_basis"] if value is not None else None
            item["gain_percent"] = (item["gain"] / data["cost_basis"] * 100
                                    if value is not None and data["cost_basis"] else None)
        item["value"] = round(value, 2) if value is not None else None
        allocation["stocks" if asset == "stock" else asset] += value or 0
        complete = complete and value is not None and previous is not None
        previous_total += previous or 0
        rows.append(item)
    total = sum(allocation.values())
    for item in rows:
        item["weight"] = round(item["value"] / total, 6) if complete and total and item["value"] is not None else None
    return {"total": round(total, 2) if complete else None, "priced_subtotal": round(total, 2),
            "allocation": {k: round(v, 2) for k, v in allocation.items()}, "holdings": rows,
            "day_change": round(total - previous_total, 2) if complete else None,
            "day_change_percent": round((total / previous_total - 1) * 100, 3) if complete and previous_total else None,
            "complete": complete, "warnings": warnings, "demo": providers.settings.demo_mode, "as_of": now()}
