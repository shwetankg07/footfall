import numpy as np
import pandas as pd
import pytest

from footfall_ml.models import Forecast
from footfall_ml.opportunities import _format_count, _next_week_detail, _peak_detail, _time_span, leaky_page, next_week, peak_hours, rank_opportunities, strong_source, weak_device
from footfall_ml.stats import proportion_pvalue


def population():
    # Balanced independent comparison groups with deliberately large effects.
    return pd.DataFrame({
        "path": ["/blog/launch"] * 100 + ["/"] * 100,
        "referrer": [None] * 100 + ["linkedin.com"] * 100,
        "device": ["mobile"] * 100 + ["desktop"] * 100,
        "bounce": [True] * 80 + [False] * 20 + [True] * 20 + [False] * 80,
        "engaged": [False] * 80 + [True] * 20 + [False] * 20 + [True] * 80,
    })


def test_leaky_page_evidence_and_impact():
    items = leaky_page(population())
    assert len(items) == 1
    item = items[0]
    assert item["type"] == "leaky_page" and item["metric"]["value"] == "/blog/launch"
    assert item["impact"] == pytest.approx(100 / 4 * (0.8 - 0.5))
    assert item["metric"]["q"] < 0.05
    assert item["metric"]["restRate"] == 0.2


def test_strong_source_and_weak_device_use_independent_rest_comparisons():
    source = strong_source(population())[0]
    device = weak_device(population())[0]
    assert source["metric"]["value"] == "linkedin.com"
    assert source["impact"] == pytest.approx(7.5)
    assert device["metric"]["value"] == "mobile"
    assert device["impact"] == pytest.approx(15)
    assert device["metric"]["restCount"] == 100


def test_comparison_copy_describes_actions_and_keeps_the_evidence_numbers():
    page, source, device = leaky_page(population())[0], strong_source(population())[0], weak_device(population())[0]
    for item in (page, source, device):
        assert "80 of 100 visitors (80.0%)" in item["detail"]
        text = item["title"] + " " + item["detail"]
        assert all(word not in text.lower() for word in ("engaged", "engagement", "lift", "entrants", "conditional", "modelled"))
    assert "/blog/launch" in page["title"] and "viewed only one page" in page["detail"]
    assert "linkedin.com" in source["title"] and "viewed another page or took an action" in source["detail"]
    assert "Mobile" in device["title"] and "took no action" in device["detail"]
    assert "50.0% across your site" in page["detail"] and "20.0% on other devices" in device["detail"]


@pytest.mark.parametrize("function", [leaky_page, strong_source, weak_device])
def test_small_samples_null_rates_and_all_identical_outcomes_do_not_generate_items(function):
    assert function(population().iloc[:49]) == []
    assert function(population().assign(engaged=True, bounce=False)) == []
    assert function(population().assign(engaged=False, bounce=True)) == []
    same = population().copy()
    same["bounce"] = [True, False] * 100
    same["engaged"] = [False, True] * 100
    assert function(same) == []
    with pytest.raises(ValueError):
        function(population(), days=0)


def test_z_test_handles_constant_rates_without_nan():
    assert proportion_pvalue(0, 50, 0, 50) == 1
    assert proportion_pvalue(50, 50, 50, 50) == 1
    assert proportion_pvalue(40, 50, 10, 50) < 0.001


def test_peak_hours_local_time_and_minimum_history():
    index = pd.date_range("2025-01-01T00:30Z", periods=28 * 24, freq="h")
    local = index.tz_convert("Asia/Kolkata")
    values = np.where((local.hour >= 20) & (local.hour < 23), 100, 5)
    history = pd.Series(values, index=index)
    assert peak_hours(history.iloc[:500]) is None
    item = peak_hours(history)
    assert item["impact"] == 0 and len(item["metric"]["windows"]) == 3
    assert all(window["startHour"] == 20 for window in item["metric"]["windows"])
    assert "8 to 11 pm (IST)" in item["detail"]
    assert item["metric"]["timezone"] == "Asia/Kolkata"
    flat = peak_hours(history * 0)
    assert flat["metric"]["windows"] == []
    assert "clear day or time" in flat["detail"]
    assert "fitted" not in flat["detail"] and "profile" not in flat["detail"]


@pytest.mark.parametrize("start,end,expected", [
    (13, 16, "1 to 4 pm"), (20, 23, "8 to 11 pm"), (9, 12, "9 am to noon"),
    (21, 24, "9 pm to midnight"), (0, 3, "midnight to 3 am"), (11, 14, "11 am to 2 pm"),
])
def test_peak_time_ranges_handle_am_pm_noon_and_midnight(start, end, expected):
    assert _time_span(start, end) == expected


def test_peak_copy_groups_only_matching_hours_and_keeps_the_local_timezone():
    windows = [{"dow": day, "startHour": 13, "endHour": 16} for day in (4, 0, 1)]
    detail = _peak_detail(windows, "Asia/Kolkata")
    assert detail == "Traffic is busiest on Mon, Tue and Fri from 1 to 4 pm (IST). Plan posts and support around these times."
    windows[0] = {"dow": 4, "startHour": 21, "endHour": 24}
    detail = _peak_detail(windows, "America/New_York")
    assert "Mon and Tue from 1 to 4 pm" in detail
    assert "Fri from 9 pm to midnight" in detail
    assert "(New York time)" in detail


def test_next_week_conditional_range_is_deterministic_and_in_local_hour_grid(monkeypatch):
    index = pd.date_range("2025-01-01T00:30Z", periods=28 * 24, freq="h")
    history = pd.Series(10, index=index)

    class Model:
        def fit(self, series, timezone):
            return self

        def predict(self, hours):
            assert hours[0] == index[-1] + pd.Timedelta(hours=2)
            assert (hours.minute == 30).all()
            return Forecast(pd.DataFrame({"expected": 12, "lo": 0, "hi": 30}, index=hours), "seasonal_profile", 0.12)

    monkeypatch.setattr("footfall_ml.opportunities.make_model", lambda name: Model())
    first, second = next_week(history, "Asia/Kolkata", "seasonal_profile"), next_week(history, "Asia/Kolkata", "seasonal_profile")
    assert first == second
    metric = first["metric"]
    assert metric["expected"] == 2016 and metric["lastWeek"] == 1680
    assert metric["changePercent"] == 20
    assert 0 <= metric["lo"] < metric["expected"] < metric["hi"]
    assert metric["coverage"] == 0.8 and metric["independentHourlyNoise"]
    assert first["detail"].startswith("About 2,020 page views expected over the next 7 days (likely ")
    assert "about 20% more than last week's 1,680" in first["detail"]
    assert all(word not in first["detail"].lower() for word in ("conditional", "independent", "noise", "uncertainty", "model"))


def test_next_week_copy_rounds_estimates_without_changing_the_metrics():
    assert _next_week_detail(3702, 3443, 3923, 3701) == "About 3,700 page views expected over the next 7 days (likely 3,440 to 3,920), close to last week's 3,700."


@pytest.mark.parametrize("expected,last,comparison", [
    (3885, 3700, "close to last week's 3,700"),
    (4000, 3700, "about 8% more than last week's 3,700"),
    (3500, 3700, "about 5% fewer than last week's 3,700"),
    (100, 0, "compared with no page views last week"),
])
def test_next_week_comparison_copy_matches_real_change(expected, last, comparison):
    assert comparison in _next_week_detail(expected, 50, 5000, last)


@pytest.mark.parametrize("value,label", [(0, "0"), (6.7, "7"), (84.3, "84"), (2016, "2,020"), (12149, "12,100")])
def test_counts_use_whole_views_and_roughly_three_significant_digits(value, label):
    assert _format_count(value) == label


def test_rank_caps_feed_and_keeps_information_at_end():
    items = [{"type": "leaky_page", "title": str(n), "impact": float(n)} for n in range(1, 12)]
    info = [{"type": "peak_hours", "title": "peak", "impact": 0}, {"type": "next_week", "title": "week", "impact": 0}]
    ranked = rank_opportunities(items + info)
    assert len(ranked) == 8
    assert [item["impact"] for item in ranked] == [11, 10, 9, 8, 7, 6, 0, 0]
