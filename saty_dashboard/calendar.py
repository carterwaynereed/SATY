"""XNYS session boundaries; every timestamp is aware and DST-safe."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from zoneinfo import ZoneInfo

import pandas as pd

ET = ZoneInfo("America/New_York")


def aware_now(value: str | datetime | None = None) -> datetime:
    if value is None:
        return datetime.now(timezone.utc)
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00")) if isinstance(value, str) else value
    if parsed.tzinfo is None:
        raise ValueError("Timestamp must include its UTC offset")
    return parsed.astimezone(timezone.utc)


@lru_cache(maxsize=1)
def exchange():
    import exchange_calendars as xcals
    return xcals.get_calendar("XNYS")


def is_session(day: date) -> bool:
    return bool(exchange().is_session(pd.Timestamp(day)))


def session_bounds(day: date) -> tuple[pd.Timestamp, pd.Timestamp]:
    cal = exchange()
    return cal.session_open(pd.Timestamp(day)).tz_convert(ET), cal.session_close(pd.Timestamp(day)).tz_convert(ET)


def previous_session(day: date) -> date:
    label = exchange().date_to_session(pd.Timestamp(day - timedelta(days=1)), direction="previous")
    return label.date()


def context(now: str | datetime | None = None) -> dict:
    current = aware_now(now).astimezone(ET)
    today = current.date()
    scheduled_today = is_session(today)
    if scheduled_today:
        opened, closed = session_bounds(today)
        status = "PREMARKET" if current < opened else ("OPEN" if current < closed else "CLOSED")
        trading_day = previous_session(today) if status == "PREMARKET" else today
    else:
        trading_day = exchange().date_to_session(pd.Timestamp(today), direction="previous").date()
        status = "HOLIDAY"
    opened, closed = session_bounds(trading_day)
    return {
        "date": trading_day.isoformat(), "calendar_date": today.isoformat(), "status": status,
        "open": opened.isoformat(), "close": closed.isoformat(), "timezone": "America/New_York",
        "refresh_minutes": 10,
        "early_close": closed.hour != 16 or closed.minute != 0,
    }


def market_gate(now: str | datetime | None = None) -> tuple[bool, str]:
    current = aware_now(now).astimezone(ET)
    if not is_session(current.date()):
        return False, "XNYS is closed for this calendar date"
    opened, closed = session_bounds(current.date())
    active = opened <= current <= closed + pd.Timedelta(minutes=15)
    return active, ("XNYS session or finalization window" if active else "Outside XNYS session and close+15m window")


def expected_bars(start_day: date, end_day: date, minutes: int = 3) -> pd.DatetimeIndex:
    parts = []
    for day in exchange().sessions_in_range(pd.Timestamp(start_day), pd.Timestamp(end_day)):
        opened, closed = session_bounds(day.date())
        parts.extend(pd.date_range(opened, closed, freq=f"{minutes}min", inclusive="left"))
    return pd.DatetimeIndex(parts, tz=ET) if not parts else pd.DatetimeIndex(parts)
