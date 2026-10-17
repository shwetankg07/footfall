from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from .visitors import DIMENSIONS

SegmentCounts = Mapping[str, Mapping[str | None, int]]
BROAD_SHARE_TOLERANCE = 0.25


def explain_change(actual: SegmentCounts, previous: Sequence[SegmentCounts], kind: str) -> tuple[list[dict[str, Any]], bool]:
    """Rank concentrated changes; broad-change drivers describe participants, not causes."""
    if kind not in ("spike", "drop"):
        raise ValueError("kind must be spike or drop")
    if len(previous) < 2:
        return [], False
    previous = previous[:4]
    candidates, broad_dimensions = [], []
    for dimension in DIMENSIONS:
        values = set(actual.get(dimension, {}))
        for week in previous:
            values.update(week.get(dimension, {}))
        rows = []
        for value in values:
            observed = int(actual.get(dimension, {}).get(value, 0))
            prior_total = sum(week.get(dimension, {}).get(value, 0) for week in previous)
            # Keep the numerator integral: summing rounded thirds can turn an
            # exactly zero total change into a tiny nonzero denominator.
            numerator = observed * len(previous) - prior_total
            row = {"dimension": dimension, "value": value, "actual": observed,
                   "expected": float(prior_total / len(previous)), "delta": float(numerator / len(previous))}
            rows.append((row, numerator, prior_total))
        total_delta = sum(numerator for _, numerator, _ in rows)
        if total_delta == 0 or (total_delta > 0) != (kind == "spike"):
            continue
        expected_total = sum(prior_total for _, _, prior_total in rows)
        concentrations = []
        for row, numerator, prior_total in rows:
            if numerator * total_delta <= 0:
                continue
            share = numerator / total_delta
            expected_share = prior_total / expected_total if expected_total else 0.0
            concentration = share - expected_share
            concentrations.append(concentration)
            if abs(row["delta"]) >= 3:
                candidates.append((row | {"share": share}, concentration))
        # Without expected traffic there is no normal mix to compare against.
        broad_dimensions.append(expected_total > 0 and max(concentrations) <= BROAD_SHARE_TOLERANCE + 1e-12)
    candidates.sort(key=lambda item: (-item[1], -abs(item[0]["delta"]), -item[0]["share"], item[0]["dimension"], str(item[0]["value"])))
    broad = bool(broad_dimensions) and all(broad_dimensions)
    return [row for row, _ in candidates[:3]], broad
