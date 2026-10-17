from types import SimpleNamespace

import pandas as pd
from bson import ObjectId

from footfall_ml.data import MongoRepository


def test_entitlements_are_two_queries_and_expiry_dates_are_the_only_gate(caplog):
    now = pd.Timestamp("2025-01-01T00:00Z")
    owners = [ObjectId() for _ in range(6)]
    users = [
        {"_id": owners[0], "plan": "pro"},
        {"_id": owners[1], "plan": "free", "proUntil": now + pd.Timedelta(seconds=1)},
        {"_id": owners[2], "plan": "free", "trialEndsAt": now + pd.Timedelta(days=1)},
        {"_id": owners[3], "plan": "pro", "proUntil": now},
        {"_id": owners[4], "proUntil": None, "trialEndsAt": now - pd.Timedelta(days=1)},
    ]
    sites = [{"_id": ObjectId(), "owner": owner} for owner in owners] + [{"_id": ObjectId()}]
    calls = []

    def find_sites(query, projection):
        calls.append("sites")
        return sites

    def find_users(query, projection):
        calls.append("users")
        assert set(query["_id"]["$in"]) == set(owners)
        assert query["$or"] == [{"proUntil": {"$gt": now.to_pydatetime()}}, {"trialEndsAt": {"$gt": now.to_pydatetime()}}]
        return [user for user in users if any(user.get(field) is not None and user[field] > now for field in ("proUntil", "trialEndsAt"))]

    repository = object.__new__(MongoRepository)
    repository.db = SimpleNamespace(sites=SimpleNamespace(find=find_sites), users=SimpleNamespace(find=find_users))
    with caplog.at_level("INFO"):
        result = repository.intelligence_sites(now)
    assert [row["owner"] for row in result] == [owners[1], owners[2]]
    assert calls == ["sites", "users"]
    assert caplog.text.count("skipped: free plan") == 5


def test_insight_unique_index_and_idempotent_upsert_keys():
    created, stored = [], {}

    def update(key, update, upsert):
        assert upsert and set(update) == {"$set"}
        stored[tuple(key.values())] = update["$set"]

    collection = SimpleNamespace(index_information=lambda: {}, create_index=lambda keys, unique: created.append((keys, unique)), update_one=update)
    repository = object.__new__(MongoRepository)
    repository.db = SimpleNamespace(insights=collection)
    repository.ensure_insight_index()
    assert created == [([("site", 1), ("kind", 1), ("key", 1)], True)]
    document = {"site": ObjectId(), "kind": "opportunities", "key": "site", "items": []}
    repository.upsert_insight(document)
    repository.upsert_insight(document | {"items": [{"title": "changed"}]})
    assert len(stored) == 1
    assert next(iter(stored.values()))["items"][0]["title"] == "changed"


def test_rca_aggregation_same_local_hour_across_dst_and_zero_weeks():
    site = ObjectId()
    hour = pd.Timestamp("2025-03-16T14:00Z")  # 10 am New York after spring transition.
    calls = []

    def aggregate(pipeline):
        calls.append(pipeline)
        match = pipeline[0]["$match"]
        assert match["site"] == site and match["name"] == "pageview"
        hours = [pd.Timestamp(clause["ts"]["$gte"]) for clause in match["$or"]]
        assert hours == [hour, pd.Timestamp("2025-03-09T14:00Z"), pd.Timestamp("2025-03-02T15:00Z"), pd.Timestamp("2025-02-23T15:00Z"), pd.Timestamp("2025-02-16T15:00Z")]
        assert pipeline[1]["$group"]["_id"]["hour"]["$dateTrunc"]["timezone"] == "America/New_York"
        return [{"_id": {"hour": hour, "referrer": None, "path": "/", "device": "desktop", "country": "IN", "browser": "Chrome"}, "count": 10}]

    repository = object.__new__(MongoRepository)
    repository.db = SimpleNamespace(events=SimpleNamespace(aggregate=aggregate))
    actual, previous = repository.alert_segments(site, hour, hour - pd.Timedelta(days=35), "America/New_York")
    assert actual["referrer"][None] == 10
    assert len(previous) == 4 and all(not row["referrer"] for row in previous)
    assert repository.alert_segments(site, hour, hour - pd.Timedelta(days=10), "America/New_York") == ({}, [])
    assert len(calls) == 1


def test_rca_nonexistent_spring_hour_is_a_zero_week_not_the_following_hour():
    repository = object.__new__(MongoRepository)
    hour = pd.Timestamp("2025-03-16T06:00Z")  # 02:00 local, absent one week earlier.

    def aggregate(pipeline):
        starts = [pd.Timestamp(clause["ts"]["$gte"]) for clause in pipeline[0]["$match"]["$or"]]
        assert len(starts) == 4  # Target + three real prior buckets; absent hour is not queried.
        assert not any(start.date() == pd.Timestamp("2025-03-09").date() for start in starts)
        return []

    repository.db = SimpleNamespace(events=SimpleNamespace(aggregate=aggregate))
    _, previous = repository.alert_segments(ObjectId(), hour, pd.Timestamp("2025-02-01T00:00Z"), "America/New_York")
    assert len(previous) == 4 and previous[0] == {}
