from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.stats import nbinom, poisson

COVERAGE = 0.99
MIN_ABSOLUTE_EFFECT = 8
MIN_DROP_EXPECTED = 10.0


def count_distribution(expected: float | np.ndarray, dispersion: float):
    mu = np.maximum(np.asarray(expected, dtype=float), 0.0)
    if dispersion <= 1e-8:
        return poisson(mu)
    size = 1 / dispersion
    return nbinom(size, size / (size + mu))


def count_interval(
    expected: np.ndarray, dispersion: float, coverage: float = COVERAGE
) -> tuple[np.ndarray, np.ndarray]:
    if not 0 < coverage < 1:
        raise ValueError("coverage must be between 0 and 1")
    distribution = count_distribution(expected, dispersion)
    tail = (1 - coverage) / 2
    return distribution.ppf(tail), distribution.ppf(1 - tail)


def estimate_dispersion(actual: np.ndarray, expected: np.ndarray, fitted_parameters: int = 0) -> float:
    """Residual method of moments, with a cap so a few spikes cannot set the band."""
    y, mu = np.asarray(actual, dtype=float), np.maximum(expected, 0.05)
    residual = y - mu
    limit = 5 * np.sqrt(mu + 0.15 * mu**2)
    squared = np.minimum(residual**2, limit**2)
    correction = len(y) / max(len(y) - fitted_parameters, len(y) / 2)
    alpha = np.sum(correction * squared - mu) / max(float(np.sum(mu**2)), 1.0)
    return float(np.clip(alpha, 0.0, 2.0))


@dataclass(frozen=True)
class Decision:
    kind: str
    score: float  # Inclusive one-sided tail probability, or its stored-band upper bound.


def detect(
    actual: int,
    expected: float,
    lo: float,
    hi: float,
    dispersion: float | None = None,
    *,
    rule: str = "count",
    coverage: float = COVERAGE,
) -> Decision | None:
    if actual < 0 or not np.isfinite([actual, expected, lo, hi]).all():
        raise ValueError("counts and forecast values must be finite and counts nonnegative")
    if expected < 0 or (dispersion is not None and (not np.isfinite(dispersion) or dispersion < 0)) or lo < 0 or hi < lo:
        raise ValueError("invalid forecast distribution or interval")
    effect = actual - expected
    if abs(effect) < MIN_ABSOLUTE_EFFECT:
        return None
    kind = "spike" if effect > 0 else "drop"
    if kind == "drop" and expected < MIN_DROP_EXPECTED:
        return None
    # The shared Mongo schema stores quantiles, not dispersion. Outside a stored
    # 99% band, 0.005 is a conservative bound on the inclusive one-sided tail.
    if dispersion is None:
        tail = (1 - coverage) / 2
    else:
        distribution = count_distribution(expected, dispersion)
        tail = float(distribution.sf(actual - 1) if kind == "spike" else distribution.cdf(actual))
    if rule == "ratio":
        # Deliberately simple benchmark; report its lack of a probability gate honestly.
        outside = actual > 2 * expected if kind == "spike" else actual < 0.5 * expected
    elif rule == "count":
        outside = (actual > hi if kind == "spike" else actual < lo) and tail <= (1 - coverage) / 2 + 1e-12
    else:
        raise ValueError(f"unknown detection rule: {rule}")
    return Decision(kind, tail) if outside else None
