from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from .models import SeasonalProfile, make_model
from .stats import bh_qvalues, proportion_pvalue
from .time import DEFAULT_TIMEZONE
from .visitors import DIMENSIONS

MIN_VISITORS = 50
FDR = 0.05


def _format_count(value: float) -> str:
    precision = max(0, len(str(int(value))) - 3)
    return f"{round(value, -precision):,.0f}"


def _clock(hour: int) -> str:
    hour %= 24
    if hour in (0, 12):
        return "midnight" if hour == 0 else "noon"
    return f"{hour % 12} {'am' if hour < 12 else 'pm'}"


def _time_span(start: int, end: int) -> str:
    if 0 < start < end < 12 or 12 < start < end < 24:
        return f"{start % 12} to {_clock(end)}"
    return f"{_clock(start)} to {_clock(end)}"


def _join_words(values: list[str]) -> str:
    return values[0] if len(values) == 1 else ", ".join(values[:-1]) + " and " + values[-1]


def _peak_detail(windows: list[dict[str, Any]], timezone: str) -> str:
    names = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
    groups: dict[tuple[int, int], list[str]] = {}
    for window in sorted(windows, key=lambda row: (row["dow"], row["startHour"])):
        groups.setdefault((window["startHour"], window["endHour"]), []).append(names[window["dow"]])
    labels = [f"{_join_words(days)} from {_time_span(start, end)}" for (start, end), days in groups.items()]
    label = {"Asia/Kolkata": "IST", "Asia/Calcutta": "IST", "UTC": "UTC"}.get(timezone)
    if label is None:
        label = timezone.rsplit("/", 1)[-1].replace("_", " ") + " time"
    return f"Traffic is busiest on {_join_words(labels)} ({label}). Plan posts and support around these times."


def _next_week_detail(expected: float, lo: float, hi: float, last: int) -> str:
    if last == 0:
        comparison = "compared with no page views last week"
    elif abs(expected - last) <= 0.05 * last:
        comparison = f"close to last week's {_format_count(last)}"
    else:
        change = abs(expected - last) / last
        comparison = f"about {change:.0%} {'more' if expected > last else 'fewer'} than last week's {_format_count(last)}"
    return f"About {_format_count(expected)} page views expected over the next 7 days (likely {_format_count(lo)} to {_format_count(hi)}), {comparison}."


def opportunity_population(visitors: list[dict[str, Any]]) -> pd.DataFrame:
    return pd.DataFrame(
        [{key: visitor[key] for key in (*DIMENSIONS, "engaged", "bounce")} for visitor in visitors if visitor["pageviews"] > 0],
        columns=[*DIMENSIONS, "engaged", "bounce"],
    )


def _comparisons(population: pd.DataFrame, dimension: str, outcome: str, worse: bool, days: float) -> list[dict[str, Any]]:
    if days <= 0:
        raise ValueError("days must be positive")
    total = len(population)
    if total < 2 * MIN_VISITORS:
        return []
    # 'worse' flips engagement to non-engagement for the one-sided test.
    successes = total - int(population[outcome].sum()) if worse else int(population[outcome].sum())
    tests = []
    for value, group in population.groupby(dimension, dropna=False, sort=False):
        count, rest_count = len(group), total - len(group)
        if count < MIN_VISITORS or rest_count < MIN_VISITORS:
            continue
        success = count - int(group[outcome].sum()) if worse else int(group[outcome].sum())
        rest_success = successes - success
        tests.append({
            "value": None if pd.isna(value) else str(value), "count": count, "success": success,
            "rate": success / count, "restCount": rest_count, "restSuccess": rest_success,
            "restRate": rest_success / rest_count, "siteRate": successes / total,
            "p": proportion_pvalue(success, count, rest_success, rest_count),
        })
    result = []
    for test, q in zip(tests, bh_qvalues([row["p"] for row in tests])):
        if q < FDR and test["rate"] > test["restRate"]:
            result.append(test | {"q": float(q), "weeklyVisitors": test["count"] * 7 / days})
    return result


def leaky_page(population: pd.DataFrame, days: float = 28) -> list[dict[str, Any]]:
    result = []
    for row in _comparisons(population, "path", "bounce", False, days):
        lift = row["rate"] - row["siteRate"]
        result.append({
            "type": "leaky_page", "title": f"Visitors starting on {row['value']} leave after one page more often",
            "detail": f"{row['success']:,} of {row['count']:,} visitors ({row['rate']:.1%}) viewed only one page, compared with {row['siteRate']:.1%} across your site. Add a clear link to what visitors should do next.",
            "impact": float(row["weeklyVisitors"] * lift),
            "metric": row | {"dimension": "path", "days": days, "lift": lift, "impactUnit": "extra_multi_page_person_days_per_week"},
        })
    return result


def strong_source(population: pd.DataFrame, days: float = 28) -> list[dict[str, Any]]:
    result = []
    for row in _comparisons(population, "referrer", "engaged", False, days):
        lift = row["rate"] - row["siteRate"]
        label = row["value"] or "Direct"
        result.append({
            "type": "strong_source", "title": f"Visitors from {label} do more on your site",
            "detail": f"{row['success']:,} of {row['count']:,} visitors ({row['rate']:.1%}) viewed another page or took an action, compared with {row['siteRate']:.1%} across your site. Try bringing more visitors from this source and see if the pattern continues.",
            "impact": float(row["weeklyVisitors"] * lift),
            "metric": row | {"dimension": "referrer", "days": days, "lift": lift, "impactUnit": "extra_engaged_person_days_per_week"},
        })
    return result


def weak_device(population: pd.DataFrame, days: float = 28) -> list[dict[str, Any]]:
    result = []
    for row in _comparisons(population, "device", "engaged", True, days):
        lift = row["rate"] - row["restRate"]
        label = row["value"] or "Unknown device"
        result.append({
            "type": "weak_device", "title": f"{label.capitalize()} visitors stop after one page more often",
            "detail": f"{row['success']:,} of {row['count']:,} visitors ({row['rate']:.1%}) viewed only one page and took no action, compared with {row['restRate']:.1%} on other devices. Check that pages load quickly and buttons work on this device.",
            "impact": float(row["weeklyVisitors"] * lift),
            "metric": row | {"dimension": "device", "days": days, "lift": lift, "impactUnit": "extra_engaged_person_days_per_week"},
        })
    return result


def peak_hours(history: pd.Series, timezone: str = DEFAULT_TIMEZONE) -> dict[str, Any] | None:
    if len(history) < 21 * 24:
        return None
    model = SeasonalProfile().fit(history, timezone)
    profile = model.profile * model.level
    windows = []
    for dow in range(7):
        for hour in range(22):
            windows.append({"dow": dow, "startHour": hour, "endHour": hour + 3, "expectedPageviews": float(profile[dow * 24 + hour : dow * 24 + hour + 3].sum())})
    windows.sort(key=lambda window: (-window["expectedPageviews"], window["dow"], window["startHour"]))
    chosen, occupied = [], set()
    for window in windows:
        start = window["dow"] * 24 + window["startHour"]
        slots = set(range(start, start + 3))
        if not occupied.intersection(slots):
            chosen.append(window)
            occupied.update(slots)
        if len(chosen) == 3:
            break
    flat = float(np.ptp(profile)) < 1e-6
    return {
        "type": "peak_hours", "title": "No clear busiest time yet" if flat else "Your busiest times of the week",
        "detail": "There isn't a clear day or time when your site gets more visits. Keep checking as more visits come in." if flat else _peak_detail(chosen, timezone),
        "impact": 0.0, "metric": {"timezone": timezone, "historyHours": len(history), "windows": [] if flat else chosen},
    }


def next_week(history: pd.Series, timezone: str, model_name: str, seed: int = 0, draws: int = 4000) -> dict[str, Any]:
    if len(history) < 168 or draws < 100:
        raise ValueError("need a week of history and at least 100 forecast draws")
    hours = pd.date_range(history.index[-1] + pd.Timedelta(hours=2), periods=168, freq="h")
    forecast = make_model(model_name).fit(history, timezone).predict(hours)
    mean = forecast.frame.expected.to_numpy()
    rng = np.random.default_rng(seed)
    if forecast.dispersion <= 1e-8:
        samples = rng.poisson(mean, size=(draws, len(mean)))
    else:
        size = 1 / forecast.dispersion
        samples = rng.negative_binomial(size, size / (size + mean), size=(draws, len(mean)))
    totals = samples.sum(axis=1)
    lo, hi = float(np.quantile(totals, 0.1, method="lower")), float(np.quantile(totals, 0.9, method="higher"))
    expected, last = float(mean.sum()), int(history.iloc[-168:].sum())
    return {
        "type": "next_week", "title": "Page views to expect next week",
        "detail": _next_week_detail(expected, lo, hi, last),
        "impact": 0.0,
        "metric": {"expected": expected, "lo": lo, "hi": hi, "coverage": 0.8, "lastWeek": last,
                   "changePercent": 100 * (expected - last) / last if last else None,
                   "forecastFrom": hours[0].to_pydatetime(), "forecastTo": (hours[-1] + pd.Timedelta(hours=1)).to_pydatetime(),
                   "model": forecast.model, "draws": draws, "independentHourlyNoise": True},
    }


def rank_opportunities(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    # Reserve the requested informational items even on sites with many leaky pages.
    evidence = sorted((item for item in items if item["impact"] > 0), key=lambda item: (-item["impact"], item["type"], item["title"]))
    information = [item for item in items if item["impact"] == 0]
    return evidence[: max(0, 8 - len(information))] + information[:8]
