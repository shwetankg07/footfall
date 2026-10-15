from types import SimpleNamespace

import pandas as pd
import pytest
from bson import ObjectId
from pymongo.errors import DuplicateKeyError

from footfall_ml.data import MongoRepository
from footfall_ml.models import Forecast


def test_explicit_database_selection_ignores_uri_default(monkeypatch):
    selected = []

    class Client:
        def __init__(self, uri, **kwargs):
            assert uri == "mongodb://example/test"
            assert kwargs["tz_aware"]

        def __getitem__(self, name):
            selected.append(name)
            return object()

    monkeypatch.setattr("footfall_ml.data.MongoClient", Client)
    MongoRepository("mongodb://example/test", "footfall")
    assert selected == ["footfall"]


@pytest.mark.parametrize("timezone,expected_start", [("UTC", "2025-01-01T00:00:00Z"), ("Asia/Kolkata", "2024-12-31T23:30:00Z")])
def test_hourly_pipeline_filters_pageviews_and_zero_fills_local_hours(timezone, expected_start):
    site = ObjectId()
    start = pd.Timestamp(expected_start)
    until = start + pd.Timedelta(hours=4)

    def aggregate(pipeline):
        assert pipeline[0]["$match"] == {"site": site, "name": "pageview", "ts": {"$gte": start.to_pydatetime(), "$lt": until.to_pydatetime()}}
        assert pipeline[1]["$group"]["_id"]["$dateTrunc"]["timezone"] == timezone
        return [{"_id": start.to_pydatetime(), "count": 2}, {"_id": (start + pd.Timedelta(hours=2)).to_pydatetime(), "count": 7}]

    repository = object.__new__(MongoRepository)
    repository.db = SimpleNamespace(events=SimpleNamespace(aggregate=aggregate))
    result = repository.hourly(site, pd.Timestamp("2025-01-01T00:07:00Z"), pd.Timestamp("2025-01-01T04:07:00Z"), timezone=timezone)
    assert result.tolist() == [2, 0, 7, 0]
    assert result.index.equals(pd.date_range(start, until, freq="h", inclusive="left"))
    assert (result.index.tz_convert(timezone).minute == 0).all()
    assert result.index[-1] == until - pd.Timedelta(hours=1)


def test_forecast_write_schema_upsert_and_historical_insert_only(monkeypatch):
    requests = []
    repository = object.__new__(MongoRepository)
    repository.db = SimpleNamespace(forecasts=SimpleNamespace(bulk_write=lambda batch, ordered: requests.extend(batch)))
    monkeypatch.setattr("footfall_ml.data.UpdateOne", lambda key, update, upsert: (key, update, upsert))
    issued = pd.Timestamp("2100-01-01T00:07:00Z")
    hour = pd.Timestamp("2100-01-01T00:30:00Z")
    frame = pd.DataFrame({"expected": [11.0], "lo": [1.0], "hi": [30.0]}, index=[hour])
    forecast = Forecast(frame, "seasonal_profile", 0.12)
    site = ObjectId()
    assert repository.save_forecasts(site, forecast, issued) == 1
    key, update, upsert = requests.pop()
    assert upsert and key == {"site": site, "hour": hour.to_pydatetime(), "metric": "pageviews"}
    assert set(update["$set"]) == {"site", "hour", "metric", "expected", "lo", "hi", "model", "updatedAt"}
    repository.save_forecasts(site, forecast, issued, historical=True)
    assert "$setOnInsert" in requests.pop()[1]
    with pytest.raises(ValueError):
        repository.save_forecasts(site, forecast, hour)


@pytest.mark.parametrize("historical", [False, True])
def test_started_local_hour_is_rejected_at_issue_time(historical):
    repository = object.__new__(MongoRepository)
    repository.db = SimpleNamespace(forecasts=SimpleNamespace(bulk_write=lambda *a, **k: pytest.fail("started bucket must not be written")))
    issued = pd.Timestamp("2100-01-01T00:37:00Z")
    forecast = Forecast(pd.DataFrame({"expected": [11.0], "lo": [1.0], "hi": [30.0]}, index=[pd.Timestamp("2100-01-01T00:30:00Z")]), "seasonal_profile", 0.12)
    with pytest.raises(ValueError, match="already started"):
        repository.save_forecasts(ObjectId(), forecast, issued, historical=historical)


def test_write_time_guard_uses_local_hour_when_job_crosses_half_hour(monkeypatch):
    requests = []
    repository = object.__new__(MongoRepository)
    repository.db = SimpleNamespace(forecasts=SimpleNamespace(bulk_write=lambda batch, ordered: requests.extend(batch)))
    monkeypatch.setattr("footfall_ml.data.UpdateOne", lambda key, update, upsert: (key, update, upsert))
    monkeypatch.setattr("footfall_ml.data.now_utc", lambda: pd.Timestamp("2025-01-01T00:37:00Z"))
    issued = pd.Timestamp("2025-01-01T00:07:00Z")
    hours = pd.date_range("2025-01-01T00:30:00Z", periods=2, freq="h")
    forecast = Forecast(pd.DataFrame({"expected": 11.0, "lo": 1.0, "hi": 30.0}, index=hours), "seasonal_profile", 0.12)
    assert repository.save_forecasts(ObjectId(), forecast, issued) == 1
    assert requests[0][0]["hour"] == pd.Timestamp("2025-01-01T01:30:00Z")


def test_hourly_fall_back_keeps_both_occurrences_of_repeated_hour():
    repository = object.__new__(MongoRepository)

    def aggregate(pipeline):
        assert pipeline[1]["$group"]["_id"]["$dateTrunc"]["timezone"] == "America/New_York"
        return [{"_id": pd.Timestamp("2025-11-02T05:00Z"), "count": 2}, {"_id": pd.Timestamp("2025-11-02T06:00Z"), "count": 3}]

    repository.db = SimpleNamespace(events=SimpleNamespace(aggregate=aggregate))
    result = repository.hourly(ObjectId(), pd.Timestamp("2025-11-02T05:45Z"), pd.Timestamp("2025-11-02T08:15Z"), timezone="America/New_York")
    assert result.index.equals(pd.date_range("2025-11-02T05:00Z", periods=3, freq="h"))
    assert result.tolist() == [2, 3, 0]
    assert result.index.tz_convert("America/New_York").hour.tolist() == [1, 1, 2]


def test_long_job_never_updates_an_hour_that_has_since_started():
    repository = object.__new__(MongoRepository)
    repository.db = SimpleNamespace(forecasts=SimpleNamespace(bulk_write=lambda *a, **k: pytest.fail("must not write a past hour")))
    issued = pd.Timestamp("2000-01-01T00:07:00Z")
    hour = pd.Timestamp("2000-01-01T00:30:00Z")
    forecast = Forecast(pd.DataFrame({"expected": [11.0], "lo": [1.0], "hi": [30.0]}, index=[hour]), "seasonal_profile", 0.12)
    assert repository.save_forecasts(ObjectId(), forecast, issued) == 0


def test_alert_duplicate_key_is_ignored_but_other_errors_propagate():
    repository = object.__new__(MongoRepository)

    def duplicate(document):
        raise DuplicateKeyError("duplicate")

    repository.db = SimpleNamespace(alerts=SimpleNamespace(insert_one=duplicate))
    assert repository.insert_alert({}) is False

    def disconnected(document):
        raise RuntimeError("connection failed")

    repository.db.alerts.insert_one = disconnected
    with pytest.raises(RuntimeError):
        repository.insert_alert({})
