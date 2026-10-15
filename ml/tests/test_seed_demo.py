from collections import Counter

import pandas as pd
import pytest
from bson import ObjectId

from footfall_ml.seed_demo import demo_events, visitor_hash
from footfall_ml.synth import generate
from footfall_ml.time import floor_hour


@pytest.mark.parametrize("timezone,start", [("UTC", "2025-01-01T00:00Z"), ("Asia/Kolkata", "2025-01-01T00:30Z")])
def test_demo_schema_funnel_and_hourly_pageview_counts(timezone, start):
    site = ObjectId("0123456789abcdef01234567")
    traffic = generate(days=7, start=start, timezone=timezone, anomalies=False)
    assert traffic.frame.index[0] == pd.Timestamp(start)
    assert (traffic.frame.index.tz_convert(timezone).minute == 0).all()
    events = list(demo_events(site, traffic, timezone=timezone))
    assert events == list(demo_events(site, traffic, timezone=timezone))
    pageviews = Counter(floor_hour(pd.Timestamp(e["ts"]), timezone) for e in events if e["name"] == "pageview")
    assert [pageviews[h] for h in traffic.frame.index] == traffic.frame["count"].tolist()
    paths = Counter(e["path"] for e in events if e["name"] == "pageview")
    assert paths["/"] > sum(n for p, n in paths.items() if p.startswith("/product/")) > paths["/cart"] > paths["/checkout"] > 0
    paid = [e for e in events if e["name"] == "paid"]
    assert 0 < len(paid) < paths["/checkout"]
    for event in events:
        assert event["site"] == site
        assert len(event["visitor"]) == 64
        int(event["visitor"], 16)
        assert event["referrer"] is None or "/" not in event["referrer"]
        assert event["ts"].tzinfo is not None
    for event in paid:
        checkout = next(e for e in events if e["name"] == "pageview" and e["path"] == "/checkout" and e["ts"] == event["ts"] - pd.Timedelta(seconds=20))
        same_day = pd.Timestamp(checkout["ts"]).tz_convert(timezone).date() == pd.Timestamp(event["ts"]).tz_convert(timezone).date()
        assert (checkout["visitor"] == event["visitor"]) == same_day


def test_visitor_hash_is_stable_per_person_and_rotates_at_local_midnight():
    site = ObjectId()
    before = pd.Timestamp("2025-01-01T18:29:59Z")
    midnight = before + pd.Timedelta(seconds=1)
    first = visitor_hash(site, 7, 42, before, "Asia/Kolkata")
    assert first == visitor_hash(site, 7, 42, before - pd.Timedelta(hours=1), "Asia/Kolkata")
    assert first != visitor_hash(site, 7, 42, midnight, "Asia/Kolkata")
    assert first != visitor_hash(site, 7, 43, before, "Asia/Kolkata")
