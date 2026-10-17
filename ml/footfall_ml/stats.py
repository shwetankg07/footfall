from __future__ import annotations

import numpy as np
from scipy.stats import norm


def bh_qvalues(pvalues: list[float]) -> np.ndarray:
    values = np.asarray(pvalues, dtype=float)
    if not len(values):
        return values
    if not np.isfinite(values).all() or ((values < 0) | (values > 1)).any():
        raise ValueError("p-values must be finite and between zero and one")
    order = np.argsort(values, kind="stable")
    adjusted = values[order] * len(values) / np.arange(1, len(values) + 1)
    result = np.empty(len(values))
    result[order] = np.minimum(np.minimum.accumulate(adjusted[::-1])[::-1], 1)
    return result


def proportion_pvalue(success: int, count: int, rest_success: int, rest_count: int) -> float:
    """One-sided pooled two-proportion z-test: inside rate > outside rate."""
    pooled = (success + rest_success) / (count + rest_count)
    variance = pooled * (1 - pooled) * (1 / count + 1 / rest_count)
    if variance == 0:
        return 1.0
    return float(norm.sf((success / count - rest_success / rest_count) / np.sqrt(variance)))
