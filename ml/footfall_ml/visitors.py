from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from typing import Any

import pandas as pd

from .time import utc

DIMENSIONS = ("referrer", "path", "device", "country", "browser")


def summarize_visitors(
    events: Iterable[dict[str, Any]], start: pd.Timestamp | None = None, end: pd.Timestamp | None = None,
) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for event in events:
        groups[event["visitor"]].append(event)
    summaries = []
    for visitor, rows in groups.items():
        rows.sort(key=lambda event: (utc(event["ts"]).value, str(event.get("_id", ""))))
        # The adapter loads the whole first local day so entry attributes can
        # precede the analysis window without letting earlier events enter a funnel.
        first_page = next((event for event in rows if event["name"] == "pageview"), {})
        window = [event for event in rows if (start is None or utc(event["ts"]) >= start) and (end is None or utc(event["ts"]) < end)]
        if not window:
            continue
        pageviews = sum(event["name"] == "pageview" for event in window)
        summaries.append({
            "visitor": visitor, **{dimension: first_page.get(dimension) for dimension in DIMENSIONS},
            "events": window, "pageviews": pageviews, "bounce": pageviews == 1,
            "engaged": pageviews >= 2 or any(event["name"] != "pageview" for event in window),
        })
    return summaries
