"""Read-only public data adapters. The unofficial TV adapter can fail at any time."""
from __future__ import annotations

import asyncio
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from .calendar import ET, aware_now, is_session, session_bounds

ROOT = Path(__file__).resolve().parents[1]
LEGACY = ROOT / "engine"
if str(LEGACY) not in sys.path:
    sys.path.insert(0, str(LEGACY))

COLUMNS = ["Open", "High", "Low", "Close", "Volume"]


class DataQualityError(RuntimeError):
    pass


@dataclass
class MarketData:
    daily: pd.DataFrame
    bars3: pd.DataFrame
    bars1: pd.DataFrame | None
    source: dict
    warnings: list[str]


def normalize(frame: pd.DataFrame, daily: bool = False) -> pd.DataFrame:
    if frame is None or frame.empty:
        raise DataQualityError("Provider returned no bars")
    df = frame.copy()
    if isinstance(df.columns, pd.MultiIndex):
        df = df.droplevel(1, axis=1)
    if not set(COLUMNS).issubset(df.columns):
        raise DataQualityError("Provider is missing required OHLCV fields")
    df = df[COLUMNS].astype(float)
    if daily:
        df.index = pd.DatetimeIndex([pd.Timestamp(x.date(), tz=ET) + pd.Timedelta(hours=9, minutes=30) for x in df.index])
    elif df.index.tz is None:
        raise DataQualityError("Intraday provider timestamps have no timezone")
    else:
        df.index = df.index.tz_convert(ET)
    if df.index.has_duplicates:
        raise DataQualityError("Provider returned duplicate timestamps")
    df = df.sort_index()
    if not np.isfinite(df.to_numpy()).all():
        raise DataQualityError("Provider returned missing or non-finite OHLCV values")
    invalid = ((df[COLUMNS[:4]] <= 0).any(axis=1) | (df.Volume < 0)
               | (df.High < df[["Open", "Close", "Low"]].max(axis=1))
               | (df.Low > df[["Open", "Close", "High"]].min(axis=1)))
    if invalid.any():
        raise DataQualityError("Provider returned invalid OHLCV geometry")
    return df


def regular_completed(frame: pd.DataFrame, now, minutes: int) -> pd.DataFrame:
    """Filter by real exchange sessions and fully completed interval boundaries."""
    df = normalize(frame)
    cutoff = pd.Timestamp(aware_now(now))
    keep = pd.Series(False, index=df.index)
    for day in sorted(set(df.index.date)):
        if not is_session(day):
            continue
        opened, closed = session_bounds(day)
        group = df.index[df.index.date == day]
        ends = group + pd.Timedelta(minutes=minutes)
        aligned = ((group - opened).total_seconds() % (minutes * 60)) == 0
        valid = (group >= opened) & (ends <= closed) & (ends <= cutoff) & aligned
        keep.loc[group] = valid
    return df.loc[keep]


def aggregate_3m(minutes: pd.DataFrame, now) -> pd.DataFrame:
    """Require all three completed 1m constituents; never publish a partial candle."""
    one = regular_completed(minutes, now, 1)
    groups = one.resample("3min", origin="start_day", offset="30min")
    three = groups.agg({"Open": "first", "High": "max", "Low": "min", "Close": "last", "Volume": "sum"})
    counts = groups.Close.count()
    three = three.loc[counts.eq(3)].dropna()
    if three.empty:
        raise DataQualityError("No complete three-minute candles")
    return regular_completed(three, now, 3)


def _tradingview(now) -> MarketData:
    import tvdata
    def pull(interval, count):
        # The supplied per-message timeout can be extended indefinitely by heartbeats.
        # Bound the entire read without changing the frozen adapter's protocol.
        async def read():
            return await asyncio.wait_for(tvdata._get("AMEX:SPY", interval, count, "regular", 15), timeout=40)
        values = asyncio.run(read())
        if not values:
            raise DataQualityError("TradingView returned no bars")
        timestamps = sorted(values)
        index = pd.to_datetime(timestamps, unit="s", utc=True).tz_convert(ET)
        return pd.DataFrame([values[t][:5] + [None] * (5 - len(values[t][:5])) for t in timestamps], index=index, columns=COLUMNS)
    daily = normalize(pull("D", 400), daily=True)
    intraday = regular_completed(pull("3", 1600), now, 3)
    meta = dict(tvdata.META.get("AMEX:SPY", {}))
    warnings = ["TradingView access uses the supplied unofficial, unauthenticated chart adapter."]
    one = None
    try:
        one = regular_completed(pull("1", 450), now, 1)
    except Exception as exc:
        warnings.append(f"One-minute resolution unavailable ({type(exc).__name__}); unresolved intrabar ties use stop-first.")
    source_id = meta.get("source_id")
    source = {
        "provider": "TradingView", "symbol": "AMEX:SPY", "interval": "3m", "session_basis": "RTH",
        "source_id": source_id, "delay_seconds": None, "reported_delay": meta.get("delay"),
        "realtime": meta.get("is_realtime") if isinstance(meta.get("is_realtime"), bool) else None,
        "data_status": meta.get("data_status"),
        # A generic CBOE/BZX identifier does not establish Cboe One parity.
        "baseline_compatible": str(source_id).strip().casefold() in {"cboe one", "cboe_one", "cboeone"},
    }
    if not source["baseline_compatible"]:
        warnings.append("Provider metadata does not establish parity with the development Cboe One feed.")
    return MarketData(daily, intraday, one, source, warnings)


def _yfinance(now, prior_error: str) -> MarketData:
    import yfinance as yf
    args = dict(progress=False, auto_adjust=False, prepost=False, threads=False, timeout=15)
    daily = normalize(yf.download("SPY", period="2y", interval="1d", **args), daily=True)
    minutes = normalize(yf.download("SPY", period="7d", interval="1m", **args))
    one = regular_completed(minutes, now, 1)
    three = aggregate_3m(one, now)
    selection_note = ("Using yfinance for both daily and intraday data." if prior_error == "not requested" else
                      f"TradingView was unavailable ({prior_error}); switched both daily and intraday data to yfinance.")
    return MarketData(daily, three, one, {
        "provider": "yfinance", "symbol": "SPY", "interval": "1m → confirmed 3m", "session_basis": "RTH",
        "source_id": "Yahoo Finance", "delay_seconds": None, "realtime": None, "baseline_compatible": False,
    }, [selection_note,
        "The fallback feed differs from the development sample; probability headlines are withheld.",
        "Provider delay is not independently verified."])


def fetch_market_data(now, provider: str = "auto") -> MarketData:
    if provider not in {"auto", "tradingview", "yfinance"}:
        raise ValueError("Unsupported provider")
    first_error = "not requested"
    if provider != "yfinance":
        try:
            return _tradingview(now)
        except Exception as exc:
            if provider == "tradingview":
                raise
            first_error = type(exc).__name__
    return _yfinance(now, first_error)
