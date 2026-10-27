from collections import Counter
from types import SimpleNamespace

import pandas as pd
import pytest
from bson import ObjectId

from footfall_ml.seed_demo import demo_events, demo_traffic, main, visitor_hash
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


def test_days_ahead_are_plain_traffic_after_the_planted_history():
    start = pd.Timestamp("2025-01-01T00:30Z")
    now = start + pd.Timedelta(days=28)
    plain = demo_traffic(28, start, timezone="Asia/Kolkata")
    ahead = demo_traffic(28, start, timezone="Asia/Kolkata", ahead_days=3)
    assert len(ahead.frame) == (28 + 3) * 24
    # Adding days ahead must not move or change the planted campaigns and outage.
    assert ahead.windows == plain.windows and len(plain.windows) == 3
    assert all(window.end <= now for window in ahead.windows)
    assert (ahead.frame.loc[ahead.frame.index >= now, "label"] == "normal").all()
    # Without an end day the generator behaves exactly as before.
    assert generate(days=20, anomaly_count=2, anomaly_start_day=4).windows == generate(days=20, anomaly_count=2, anomaly_start_day=4, anomaly_end_day=20).windows


class Collection:
    def __init__(self, *docs):
        self.docs = list(docs)

    def find_one(self, query, projection=None):
        return next((doc for doc in self.docs if all(doc.get(key) == value for key, value in query.items())), None)

    def delete_many(self, query):
        keep = [doc for doc in self.docs if not all(doc.get(key) == value for key, value in query.items())]
        removed, self.docs = len(self.docs) - len(keep), keep
        return SimpleNamespace(deleted_count=removed)

    def insert_many(self, docs, ordered=True):
        self.docs.extend(docs)


def test_reset_replaces_events_clears_derived_documents_and_writes_ahead(monkeypatch):
    site, other = ObjectId(), ObjectId()
    db = SimpleNamespace(
        sites=Collection({"_id": site, "timezone": "Asia/Kolkata"}),
        events=Collection({"site": site, "old": True}, {"site": other}),
        **{name: Collection({"site": site}, {"site": other}) for name in ("forecasts", "alerts", "insights")},
    )
    monkeypatch.setattr("footfall_ml.seed_demo.MongoRepository", lambda *args: SimpleNamespace(db=db, close=lambda: None))
    monkeypatch.setenv("MONGO_URI", "mongodb://test")
    now = pd.Timestamp.now(tz="UTC")
    assert main(["--site", str(site), "--days", "14", "--ahead-days", "2", "--reset"]) == 0
    for collection in (db.forecasts, db.alerts, db.insights):
        assert collection.docs == [{"site": other}]
    mine = [event for event in db.events.docs if event["site"] == site]
    assert {"site": other} in db.events.docs and not any(event.get("old") for event in mine)
    assert max(event["ts"] for event in mine) > (now + pd.Timedelta(days=1)).to_pydatetime()
