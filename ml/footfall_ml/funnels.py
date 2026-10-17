from __future__ import annotations

from math import exp, log, sqrt
from typing import Any

import pandas as pd
from scipy.stats import fisher_exact

from .stats import bh_qvalues
from .visitors import DIMENSIONS

MIN_ENTERED = 30
FDR = 0.1


def step_matches(step: dict[str, str], event: dict[str, Any]) -> bool:
    if step["kind"] == "event":
        return event["name"] == step["value"]
    if event["name"] != "pageview":
        return False
    value = step["value"]
    return event["path"].startswith(value[:-1]) if value.endswith("*") else event["path"] == value


def steps_reached(steps: list[dict[str, str]], events: list[dict[str, Any]]) -> int:
    reached = 0
    for event in events:
        if reached < len(steps) and step_matches(steps[reached], event):
            reached += 1
    return reached


def funnel_population(visitors: list[dict[str, Any]], steps: list[dict[str, str]]) -> pd.DataFrame:
    rows = []
    if steps:
        for visitor in visitors:
            reached = steps_reached(steps, visitor["events"])
            if reached:
                rows.append({**{key: visitor[key] for key in DIMENSIONS}, "converted": reached == len(steps)})
    return pd.DataFrame(rows, columns=[*DIMENSIONS, "converted"])


def conversion_drivers(population: pd.DataFrame) -> list[dict[str, Any]]:
    if len(population) < 2 * MIN_ENTERED:
        return []
    total = len(population)
    converted = int(population.converted.sum())
    tests = []
    for dimension in DIMENSIONS:
        for value, group in population.groupby(dimension, dropna=False, sort=False):
            entered, inside = len(group), int(group.converted.sum())
            rest, outside = total - entered, converted - inside
            if entered < MIN_ENTERED or rest < MIN_ENTERED:
                continue
            a, b, c, d = inside, entered - inside, outside, rest - outside
            log_odds = log((a + 0.5) * (d + 0.5) / ((b + 0.5) * (c + 0.5)))
            standard_error = sqrt(sum(1 / (count + 0.5) for count in (a, b, c, d)))
            tests.append({
                "dimension": dimension, "value": None if pd.isna(value) else str(value),
                "entered": entered, "converted": inside, "rate": inside / entered,
                "restRate": outside / rest, "oddsRatio": exp(log_odds),
                "ciLow": exp(log_odds - 1.959963984540054 * standard_error),
                "ciHigh": exp(log_odds + 1.959963984540054 * standard_error),
                "direction": "better" if log_odds > 0 else "worse",
                "p": float(fisher_exact([[a, b], [c, d]]).pvalue),
            })
    qvalues = bh_qvalues([test["p"] for test in tests])
    significant = [test | {"q": float(q)} for test, q in zip(tests, qvalues) if q < FDR]
    significant.sort(key=lambda test: (-abs(log(test["oddsRatio"])), test["dimension"], str(test["value"])))
    result, counts = [], {"better": 0, "worse": 0}
    for test in significant:
        if counts[test["direction"]] < 5:
            counts[test["direction"]] += 1
            result.append({key: value for key, value in test.items() if key != "p"})
    return result
