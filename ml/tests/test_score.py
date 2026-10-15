from copy import deepcopy
from urllib.error import URLError

import pandas as pd
import pytest
from bson import ObjectId

from footfall_ml.models import Forecast
from footfall_ml.score import flush_alerts, main, run
from footfall_ml.time import DEFAULT_TIMEZONE, floor_hour


class FakeRepository:
    def __init__(self, timezone=DEFAULT_TIMEZONE, start="2025-01-01T00:30Z"):
        self.site_id = ObjectId("0123456789abcdef01234567")
        self.site_rows = [{"_id": self.site_id, "timezone": timezone}]
        self.counts = pd.Series(20, index=pd.date_range(floor_hour(pd.Timestamp(start), timezone), periods=28 * 24, freq="h"))
        self.first = self.counts.index[0]
        self.bands = {}
        self.alerts = {}
        self.reads = []
        self.hourly_timezones = []

    def sites(self, site=None):
        return [s for s in self.site_rows if site is None or s["_id"] == site]

    def first_event(self, site):
        return self.first

    def hourly(self, site, start, until, timezone=DEFAULT_TIMEZONE):
        self.reads.append(until)
        self.hourly_timezones.append(timezone)
        return self.counts.reindex(pd.date_range(start, until, freq="h", inclusive="left"), fill_value=0)

    def forecasts(self, site, hours):
        return {hour: deepcopy(self.bands[(site, hour)]) for hour in hours if (site, hour) in self.bands}

    def save_forecasts(self, site, forecast, issued_at, historical=False, timezone=DEFAULT_TIMEZONE):
        for hour, values in forecast.frame.iterrows():
            assert hour > floor_hour(issued_at, timezone)
            assert hour == floor_hour(hour, timezone)
            key = (site, hour)
            if not historical or key not in self.bands:
                self.bands[key] = values.to_dict() | {"model": forecast.model, "updatedAt": issued_at}
        return len(forecast.frame)

    def insert_alert(self, alert):
        key = (alert["site"], alert["hour"], alert["metric"])
        if key in self.alerts:
            return False
        self.alerts[key] = deepcopy(alert)
        return True


def test_rerun_is_idempotent_and_preserves_stored_band_and_alert_status():
    repository = FakeRepository()
    now = repository.counts.index[-1] + pd.Timedelta(hours=1, minutes=7)
    hour = floor_hour(now) - pd.Timedelta(hours=1)
    repository.counts.loc[hour] = 100
    key = (repository.site_id, hour)
    repository.bands[key] = {"expected": 11.0, "lo": 1.0, "hi": 30.0, "model": "seasonal_profile", "updatedAt": hour - pd.Timedelta(hours=6)}
    original_band = deepcopy(repository.bands[key])
    _, first_alerts = run(repository, now, model_name="seasonal_profile")
    assert first_alerts == 1
    alert = next(iter(repository.alerts.values()))
    assert alert["expected"] == 11  # stored forecast, not a newly fitted ~20
    assert alert["notifiedAt"] is None and alert["readBy"] == []
    alert["readBy"] = [ObjectId()]
    alert["notifiedAt"] = now.to_pydatetime()
    original_alert = deepcopy(alert)
    _, second_alerts = run(repository, now, model_name="seasonal_profile")
    assert second_alerts == 0
    assert len(repository.alerts) == 1
    assert repository.bands[key] == original_band
    assert next(iter(repository.alerts.values())) == original_alert
    assert len(repository.bands) == 25
    future = [hour for site, hour in repository.bands if hour > floor_hour(now)]
    assert len(future) == 24
    assert min(future) == floor_hour(now) + pd.Timedelta(hours=1)


def test_fallback_fits_strictly_before_each_target_and_checks_all_three(monkeypatch):
    repository = FakeRepository()
    now = repository.counts.index[-1] + pd.Timedelta(hours=1)
    checked = repository.counts.index[-3:]
    repository.counts.loc[checked] = 100
    training_ends = []

    class SpyModel:
        def fit(self, history, timezone):
            training_ends.append(history.index[-1])
            self.end = history.index[-1]
            return self

        def predict(self, hours):
            assert self.end < hours.min()
            return Forecast(pd.DataFrame({"expected": 20.0, "lo": 2.0, "hi": 50.0}, index=hours), "seasonal_profile", 0.12)

    monkeypatch.setattr("footfall_ml.score.make_model", lambda name: SpyModel())
    _, alerts = run(repository, now, model_name="seasonal_profile")
    assert alerts == 3
    assert training_ends[:3] == [hour - pd.Timedelta(hours=1) for hour in checked]


def test_dry_run_has_no_mutations_and_missing_uri_is_clear(monkeypatch, caplog):
    repository = FakeRepository()
    now = repository.counts.index[-1] + pd.Timedelta(hours=1)
    run(repository, now, dry_run=True, model_name="seasonal_profile")
    assert not repository.alerts and not repository.bands
    monkeypatch.delenv("MONGO_URI", raising=False)
    assert main(["--dry-run"]) == 2
    assert "MONGO_URI is not set" in caplog.text


def test_backfill_is_causal_and_preserves_existing_forecasts():
    repository = FakeRepository()
    now = repository.counts.index[-1] + pd.Timedelta(hours=1, minutes=7)
    cutoff = floor_hour(now)
    hour = cutoff - pd.Timedelta(hours=12)
    original = {"expected": 27.0, "lo": 3.0, "hi": 60.0, "model": "seasonal_profile"}
    repository.bands[(repository.site_id, hour)] = deepcopy(original)
    run(repository, now, backfill_days=1, model_name="seasonal_profile")
    assert repository.bands[(repository.site_id, hour)] == original
    assert repository.reads == list(pd.date_range(cutoff - pd.Timedelta(days=1), cutoff, freq="h"))
    snapshots = deepcopy(repository.bands)
    run(repository, now, backfill_days=1, model_name="seasonal_profile")
    assert repository.bands == snapshots


def test_ist_forecasts_and_last_three_alert_hours_match_dashboard():
    repository = FakeRepository()
    now = pd.Timestamp("2025-01-29T00:07Z")
    cutoff = pd.Timestamp("2025-01-28T23:30Z")
    completed = pd.date_range("2025-01-28T20:30Z", periods=3, freq="h")
    repository.counts.loc[completed] = 100
    repository.counts.loc[cutoff] = 100000  # Partial current bucket must be excluded.
    written, alerts = run(repository, now, model_name="seasonal_profile")
    assert (written, alerts) == (24, 3)
    assert repository.reads == [cutoff]
    assert repository.hourly_timezones == ["Asia/Kolkata"]
    assert sorted(pd.Timestamp(alert["hour"]) for alert in repository.alerts.values()) == list(completed)
    assert sorted(hour for _, hour in repository.bands) == list(pd.date_range("2025-01-29T00:30Z", periods=24, freq="h"))
    assert all(hour.minute == 30 for _, hour in repository.bands)


def test_backfill_origins_are_chosen_separately_for_each_site_timezone(monkeypatch):
    repository = FakeRepository()
    utc_site = ObjectId()
    repository.site_rows.append({"_id": utc_site, "timezone": "UTC"})
    calls = []

    def record(repository, site, moment, **kwargs):
        calls.append((site["_id"], moment, kwargs["historical"]))
        return 0, 0

    monkeypatch.setattr("footfall_ml.score.score_site", record)
    now = pd.Timestamp("2025-01-29T00:07Z")
    run(repository, now, backfill_days=1)
    ist = [(moment, historical) for site, moment, historical in calls if site == repository.site_id]
    other = [(moment, historical) for site, moment, historical in calls if site == utc_site]
    assert len(ist) == len(other) == 25
    assert ist[0] == (pd.Timestamp("2025-01-27T23:30Z"), True)
    assert other[0] == (pd.Timestamp("2025-01-28T00:00Z"), True)
    assert all(moment.minute == 30 for moment, historical in ist if historical)
    assert all(moment.minute == 0 for moment, historical in other if historical)
    assert ist[-1] == other[-1] == (now, False)


@pytest.mark.parametrize("instant,expected_cutoff", [
    ("2025-03-09T07:15Z", "2025-03-09T07:00Z"),
    ("2025-11-02T05:37Z", "2025-11-02T05:00Z"),
    ("2025-11-02T06:37Z", "2025-11-02T06:00Z"),
])
def test_scoring_across_dst_transition_hours(instant, expected_cutoff):
    now = pd.Timestamp(instant)
    repository = FakeRepository(timezone="America/New_York", start=now - pd.Timedelta(days=28))
    written, _ = run(repository, now, model_name="seasonal_profile")
    cutoff = pd.Timestamp(expected_cutoff)
    assert written == 24
    assert repository.reads == [cutoff]
    assert sorted(hour for _, hour in repository.bands) == list(pd.date_range(cutoff + pd.Timedelta(hours=1), periods=24, freq="h"))


def test_ineligible_and_broken_sites_do_not_stop_other_sites(caplog):
    repository = FakeRepository()
    repository.site_rows.insert(0, {"_id": ObjectId(), "timezone": "Invalid/Timezone"})
    now = repository.counts.index[-1] + pd.Timedelta(hours=1)
    written, _ = run(repository, now, model_name="seasonal_profile")
    assert written == 24
    assert "failed" in caplog.text
    repository.counts[:] = 0
    assert run(repository, now, model_name="seasonal_profile") == (0, 0)
    repository.first = now - pd.Timedelta(days=3)
    assert run(repository, now, model_name="seasonal_profile") == (0, 0)


def test_flush_request_and_failure_retry(caplog):
    seen = []

    def unavailable(request, timeout):
        seen.append((request, timeout))
        raise URLError("offline")

    flush_alerts("https://api.example/", "test-secret", opener=unavailable)
    flush_alerts("https://api.example/", "test-secret", opener=unavailable)
    request, timeout = seen[0]
    assert len(seen) == 2
    assert request.full_url == "https://api.example/internal/alerts/flush"
    assert request.data == b"{}" and request.method == "POST" and timeout == 10
    assert request.get_header("X-internal-secret") == "test-secret"
    assert "retried next run" in caplog.text
