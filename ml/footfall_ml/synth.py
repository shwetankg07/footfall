from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

LEVELS = {"low": 2.0, "medium": 20.0, "high": 200.0}


@dataclass(frozen=True)
class AnomalyWindow:
    start: pd.Timestamp
    end: pd.Timestamp  # exclusive
    kind: str
    factor: float


@dataclass(frozen=True)
class Traffic:
    frame: pd.DataFrame
    windows: tuple[AnomalyWindow, ...]


def generate(
    days: int = 35,
    level: str | float = "medium",
    seed: int = 7,
    start: str | pd.Timestamp = "2025-01-06T00:00:00Z",
    timezone: str = "Asia/Kolkata",
    dispersion: float = 0.12,
    anomalies: bool = True,
    anomaly_count: int = 8,
    anomaly_start_day: int = 21,
    spikes_only: bool = False,
) -> Traffic:
    """NB2 traffic: variance = mean + dispersion * mean**2; labels are windows."""
    if days < 1 or dispersion < 0 or anomaly_count < 0 or anomaly_start_day < 0:
        raise ValueError("days must be positive; dispersion and anomaly settings nonnegative")
    scale = LEVELS[level] if isinstance(level, str) else float(level)
    if scale <= 0:
        raise ValueError("level must be positive")
    rng = np.random.default_rng(seed)
    first = pd.Timestamp(start)
    first = first.tz_localize("UTC") if first.tzinfo is None else first.tz_convert("UTC")
    # Preserve the supplied bucket anchor, which may be :30 UTC for local hours.
    index = pd.date_range(first, periods=days * 24, freq="h")
    local = index.tz_convert(timezone)
    hour = local.hour.to_numpy() + local.minute.to_numpy() / 60
    # Morning ramp, broad afternoon peak, and a smaller evening peak.
    curve = 0.20 + np.exp(-0.5 * ((hour - 14) / 4.0) ** 2)
    curve += 0.45 * np.exp(-0.5 * ((hour - 21) / 2.3) ** 2)
    curve /= curve.mean()
    dow = np.array([1.05, 1.10, 1.12, 1.08, 1.00, 0.76, 0.70])[local.dayofweek]
    dow = dow / np.mean([1.05, 1.10, 1.12, 1.08, 1.00, 0.76, 0.70])
    trend = np.exp(np.linspace(-0.10, 0.10, len(index)))
    # A mild unmodelled daily component prevents perfectly repeating toy data.
    day_effect = np.repeat(rng.lognormal(-0.5 * 0.07**2, 0.07, days), 24)
    normal = scale * curve * dow * trend * day_effect
    rate = normal.copy()
    labels = np.full(len(index), "normal", dtype=object)
    windows: list[AnomalyWindow] = []
    first_allowed = anomaly_start_day * 24
    if anomalies and anomaly_count:
        candidates = np.arange(first_allowed, len(index) - 7)
        # Spread windows across the evaluation period, without overlap.
        if len(candidates) < anomaly_count * 12:
            raise ValueError("not enough hours for separated anomaly windows")
        for number, chunk in enumerate(np.array_split(candidates, anomaly_count)):
            position = int(rng.choice(chunk[3:-3] if len(chunk) > 6 else chunk))
            kind = "spike" if spikes_only or number % 2 == 0 else "drop"
            duration = int(rng.integers(1, 4) if kind == "spike" else rng.integers(2, 7))
            factor = float(rng.uniform(3, 6) if kind == "spike" else rng.choice([0.0, 0.05, 0.15]))
            rate[position : position + duration] *= factor
            labels[position : position + duration] = kind
            windows.append(AnomalyWindow(index[position], index[position + duration], kind, factor))
    if dispersion == 0:
        count = rng.poisson(rate)
    else:
        size = 1 / dispersion
        count = rng.negative_binomial(size, size / (size + rate))
    return Traffic(
        pd.DataFrame({"count": count, "normal_mean": normal, "mean": rate, "label": labels}, index=index),
        tuple(windows),
    )
