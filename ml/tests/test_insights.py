from collections import Counter
from copy import deepcopy

import pandas as pd
import pytest
from bson import ObjectId

from footfall_ml.insights import main, run
from footfall_ml.seed_demo import demo_events, demo_traffic
from footfall_ml.time import floor_hour
from footfall_ml.visitors import DIMENSIONS
from test_score import FakeRepository

STEPS = [{"kind": "page", "value": "/"}, {"kind": "page", "value": "/product/*"}, {"kind": "page", "value": "/cart"}, {"kind": "event", "value": "paid"}]


@pytest.fixture(scope="module")
def demo():
    site = ObjectId("0123456789abcdef01234567")
    traffic = demo_traffic(28, pd.Timestamp("2025-01-05T18:30Z"))
    events = list(demo_events(site, traffic))
    for n, event in enumerate(events):
        event["_id"] = ObjectId(f"{n:024x}")
    return site, traffic, events


class InsightsRepository(FakeRepository):
    def __init__(self, demo):
        super().__init__()
        self.site_id, self.traffic, self.event_rows = demo
        self.counts = self.traffic.frame["count"]
        self.first = self.counts.index[0]
        self.insights = {}
        self.event_reads = []
        self.entitled = True
        self.entitlement_checks = []
        self.closed = False
        self.segment_counts = {}
        for event in self.event_rows:
            if event["name"] == "pageview":
                hour = floor_hour(event["ts"])
                bucket = self.segment_counts.setdefault(hour, {dimension: Counter() for dimension in DIMENSIONS})
                for dimension in DIMENSIONS:
                    bucket[dimension][event.get(dimension)] += 1

    def intelligence_sites(self, now, site=None):
        self.entitlement_checks.append(now)
        return self.sites(site) if self.entitled else []

    def events(self, site, start, until):
        self.event_reads.append((start, until))
        return [event for event in self.event_rows if start <= pd.Timestamp(event["ts"]) < until]

    def funnels(self, site):
        return [{"_id": ObjectId("100000000000000000000001"), "site": site, "name": "Shop", "steps": STEPS}]

    def upsert_insight(self, document):
        self.insights[(document["site"], document["kind"], document["key"])] = deepcopy(document)

    def alert_segments(self, site, hour, first, timezone):
        return self.segment_counts.get(hour, {}), [self.segment_counts.get(hour - pd.Timedelta(weeks=n), {}) for n in range(1, 5) if hour - pd.Timedelta(weeks=n) >= first]

    def close(self):
        self.closed = True


def test_daily_insights_match_schema_are_idempotent_and_demo_drivers_are_found(demo):
    repository = InsightsRepository(demo)
    now = repository.counts.index[-1] + pd.Timedelta(hours=1, minutes=7)
    assert run(repository, now) == 2
    assert len(repository.insights) == 2
    funnel = next(row for row in repository.insights.values() if row["kind"] == "funnel_drivers")
    assert set(funnel) == {"site", "kind", "key", "funnel", "from", "to", "computedAt", "entered", "converted", "rate", "drivers"}
    assert funnel["entered"] > 1000 and 0 < funnel["converted"] < funnel["entered"]
    assert funnel["rate"] == funnel["converted"] / funnel["entered"]
    linkedin = next(driver for driver in funnel["drivers"] if driver["dimension"] == "referrer" and driver["value"] == "linkedin.com")
    assert linkedin["direction"] == "better" and linkedin["q"] < 0.1
    assert 1.5 < linkedin["rate"] / linkedin["restRate"] < 2.7
    assert set(linkedin) == {"dimension", "value", "entered", "converted", "rate", "restRate", "oddsRatio", "ciLow", "ciHigh", "q", "direction"}
    opportunities = next(row for row in repository.insights.values() if row["kind"] == "opportunities")
    items = opportunities["items"]
    assert 4 <= len(items) <= 8
    assert any(item["type"] == "leaky_page" and item["metric"]["value"] == "/blog/launch" for item in items)
    assert any(item["type"] == "weak_device" and item["metric"]["value"] == "mobile" for item in items)
    assert {item["type"] for item in items[-2:]} == {"peak_hours", "next_week"}
    assert [item["impact"] for item in items] == sorted((item["impact"] for item in items), reverse=True)
    original = deepcopy(repository.insights)
    assert run(repository, now) == 2 and repository.insights == original
    assert all(pd.Timestamp(row["to"]).minute == 30 for row in repository.insights.values())


def test_daily_dry_run_and_plan_gate_do_not_write_or_read_free_events(demo):
    repository = InsightsRepository(demo)
    now = repository.counts.index[-1] + pd.Timedelta(hours=1)
    assert run(repository, now, dry_run=True) == 0
    assert not repository.insights
    repository.entitled = False
    repository.event_reads.clear()
    assert run(repository, now) == 0
    assert not repository.insights and not repository.event_reads
    assert repository.entitlement_checks == [now, now]


def test_first_entry_metadata_query_includes_utc_midnight(demo):
    repository = InsightsRepository(demo)
    now = repository.counts.index[-1] + pd.Timedelta(hours=2, minutes=7)
    run(repository, now, dry_run=True)
    start, _ = repository.event_reads[0]
    assert start.hour == 0 and start.minute == 0


def test_site_failures_are_isolated_and_cli_missing_uri_is_clear(demo, monkeypatch, caplog):
    repository = InsightsRepository(demo)
    repository.site_rows.insert(0, {"_id": ObjectId(), "timezone": "Invalid/Timezone"})
    now = repository.counts.index[-1] + pd.Timedelta(hours=1)
    assert run(repository, now) == 2
    assert "insights failed; continuing" in caplog.text
    monkeypatch.delenv("MONGO_URI", raising=False)
    assert main(["--dry-run"]) == 2
    assert "MONGO_URI is not set" in caplog.text


def test_cli_dry_run_never_creates_indexes(demo, monkeypatch):
    repository = InsightsRepository(demo)
    repository.ensure_insight_index = lambda: pytest.fail("dry-run must not create indexes")
    monkeypatch.setenv("MONGO_URI", "mongodb://unused")
    monkeypatch.setattr("footfall_ml.insights.MongoRepository", lambda *args: repository)
    monkeypatch.setattr("footfall_ml.insights.run", lambda repo, now, **kwargs: 0 if kwargs["dry_run"] else pytest.fail("must be dry run"))
    assert main(["--dry-run"]) == 0
    assert repository.closed


def test_hourly_alerts_have_campaign_drivers_and_outage_evidence(demo):
    from footfall_ml.score import run as score

    repository = InsightsRepository(demo)
    for window in repository.traffic.windows:
        score(repository, window.end + pd.Timedelta(minutes=7), model_name="seasonal_profile")
    alerts = list(repository.alerts.values())
    assert alerts
    assert all("drivers" in alert and isinstance(alert["broad"], bool) for alert in alerts)
    referrers = {driver["value"] for alert in alerts if alert["kind"] == "spike" for driver in alert["drivers"] if driver["dimension"] == "referrer"}
    assert {"news.ycombinator.com", "linkedin.com"} <= referrers
    assert any(alert["kind"] == "drop" and alert["actual"] == 0 for alert in alerts)
    outage = next(window for window in repository.traffic.windows if window.kind == "drop")
    outage_alerts = [alert for alert in alerts if outage.start <= pd.Timestamp(alert["hour"]) < outage.end]
    assert len(outage_alerts) == 3 and all(alert["broad"] for alert in outage_alerts)
    snapshot = deepcopy(repository.alerts)
    for window in repository.traffic.windows:
        score(repository, window.end + pd.Timedelta(minutes=7), model_name="seasonal_profile")
    assert repository.alerts == snapshot
    repository.entitled = False
    repository.reads.clear()
    score(repository, repository.counts.index[-1] + pd.Timedelta(hours=1), backfill_days=1, model_name="seasonal_profile")
    assert repository.reads == []


def test_backfill_new_alerts_also_have_statistical_drivers(demo):
    from footfall_ml.score import run as score

    repository = InsightsRepository(demo)
    outage = next(window for window in repository.traffic.windows if window.kind == "drop")
    score(repository, outage.end + pd.Timedelta(hours=1, minutes=7), backfill_days=1, model_name="seasonal_profile")
    alerts = [alert for alert in repository.alerts.values() if outage.start <= pd.Timestamp(alert["hour"]) < outage.end]
    assert len(alerts) == 3 and all(alert["drivers"] and alert["broad"] for alert in alerts)


def test_twenty_one_day_backfill_keeps_forecasts_but_never_alerts_during_warmup(demo):
    from footfall_ml.score import run as score

    repository = InsightsRepository(demo)
    now = repository.counts.index[-1] + pd.Timedelta(hours=1, minutes=7)
    score(repository, now, backfill_days=21, model_name="seasonal_profile")
    assert min(hour for _, hour in repository.bands) == repository.first + pd.Timedelta(days=7, hours=1)
    assert repository.alerts
    assert all(pd.Timestamp(alert["hour"]) >= repository.first + pd.Timedelta(days=14) for alert in repository.alerts.values())


@pytest.mark.parametrize("days", [7, 14, 28])
def test_demo_can_be_generated_for_every_supported_short_history(days):
    traffic = demo_traffic(days, pd.Timestamp("2025-01-05T18:30Z"))
    assert len(traffic.frame) == days * 24
    assert sum(window.kind == "spike" for window in traffic.windows) == 2
    assert sum(window.kind == "drop" for window in traffic.windows) == 1


def test_demo_outage_zeroes_every_segment_and_totals_still_match(demo):
    _, traffic, events = demo
    outages = [window for window in traffic.windows if window.kind == "drop"]
    assert len(outages) == 1 and outages[0].end - outages[0].start == pd.Timedelta(hours=3)
    assert not any(outages[0].start <= pd.Timestamp(event["ts"]) < outages[0].end for event in events)
    counts = Counter(floor_hour(event["ts"]) for event in events if event["name"] == "pageview")
    assert [counts[hour] for hour in traffic.frame.index] == traffic.frame["count"].tolist()


@pytest.mark.parametrize("start", ["2025-01-05T18:30Z", "2025-01-09T14:30Z", "2025-01-12T05:30Z", "2025-01-13T23:30Z"])
def test_every_demo_refresh_tells_the_same_story(start):
    """The nightly refresh runs whenever GitHub gets to it; the demo's story can't depend on the hour."""
    from footfall_ml.score import run as score

    site = ObjectId("0123456789abcdef01234567")
    traffic = demo_traffic(28, pd.Timestamp(start), ahead_days=3)
    events = [event | {"_id": ObjectId(f"{n:024x}")} for n, event in enumerate(demo_events(site, traffic))]
    repository = InsightsRepository((site, traffic, events))
    score(repository, traffic.frame.index[28 * 24 - 1] + pd.Timedelta(hours=1, minutes=7), backfill_days=21, model_name="seasonal_profile")
    alerts = list(repository.alerts.values())
    within = lambda window: [alert for alert in alerts if window.start <= pd.Timestamp(alert["hour"]) < window.end]
    spikes = [window for window in traffic.windows if window.kind == "spike"]
    for window, source in zip(spikes, ["news.ycombinator.com", "linkedin.com"]):
        flagged = within(window)
        assert flagged and all(alert["drivers"][0]["value"] == source for alert in flagged)
    outage = next(window for window in traffic.windows if window.kind == "drop")
    assert len(within(outage)) == 3 and all(alert["broad"] for alert in within(outage))
    assert sum(not any(window.start <= pd.Timestamp(alert["hour"]) < window.end for window in traffic.windows) for alert in alerts) <= 2
