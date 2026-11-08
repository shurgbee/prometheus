"""Shared market-session policy for the API and worker."""
from functools import lru_cache

from .db import now


@lru_cache(maxsize=1)
def calendar():
    import exchange_calendars
    return exchange_calendars.get_calendar("XNYS")


def market_open():
    return bool(calendar().is_open_on_minute(now().replace(second=0, microsecond=0)))
