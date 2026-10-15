from __future__ import annotations

from datetime import datetime

import pandas as pd

DEFAULT_TIMEZONE = "Asia/Kolkata"


def now_utc() -> pd.Timestamp:
    return pd.Timestamp.now(tz="UTC")


def utc(value: datetime | pd.Timestamp) -> pd.Timestamp:
    result = pd.Timestamp(value)
    return result.tz_localize("UTC") if result.tzinfo is None else result.tz_convert("UTC")


def floor_hour(value: datetime | pd.Timestamp, timezone: str = DEFAULT_TIMEZONE) -> pd.Timestamp:
    local = utc(value).tz_convert(timezone)
    # Retain which occurrence of a repeated fall-back hour the instant belongs to.
    return local.floor("h", ambiguous=bool(local.dst()), nonexistent="shift_forward").tz_convert("UTC")
