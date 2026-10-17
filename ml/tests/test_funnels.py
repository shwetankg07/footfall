import numpy as np
import pandas as pd
import pytest
from bson import ObjectId
from scipy.stats import fisher_exact

from footfall_ml.drivers_simulation import simulate_population
from footfall_ml.funnels import conversion_drivers, funnel_population, step_matches, steps_reached
from footfall_ml.stats import bh_qvalues
from footfall_ml.visitors import summarize_visitors

STEPS = [{"kind": "page", "value": "/"}, {"kind": "page", "value": "/product/*"}, {"kind": "page", "value": "/cart"}, {"kind": "event", "value": "paid"}]


def test_funnel_rules_match_server_order_wildcards_and_repeats():
    def page(path):
        return {"name": "pageview", "path": path}
    events = [page("/cart"), page("/"), page("/"), {"name": "paid", "path": "/"}, page("/product/keyboard"), page("/cart"), {"name": "paid", "path": "/checkout"}]
    assert steps_reached(STEPS, events) == 4
    assert steps_reached(STEPS, events[:-1]) == 3
    assert steps_reached([STEPS[0], STEPS[0]], [page("/")]) == 1
    assert not step_matches(STEPS[1], page("/product"))
    assert not step_matches(STEPS[0], {"name": "paid", "path": "/"})


def test_entry_attributes_first_page_and_objectid_tie_order():
    instant = pd.Timestamp("2025-01-01T00:30Z")
    ids = [ObjectId(f"{n:024x}") for n in range(1, 5)]
    events = [{"_id": ids[n], "visitor": "person-day", "ts": instant, "name": name, "path": path,
               "referrer": "linkedin.com" if n == 0 else None, "device": "desktop", "country": "IN", "browser": "Chrome"}
              for n, (name, path) in enumerate([("pageview", "/landing"), ("pageview", "/"), ("pageview", "/product/keyboard"), ("paid", "/")])]
    summaries = summarize_visitors(list(reversed(events)))
    population = funnel_population(summaries, [STEPS[0], STEPS[1], STEPS[3]])
    assert len(population) == 1 and population.converted.iloc[0]
    assert population.referrer.iloc[0] == "linkedin.com"
    assert population.path.iloc[0] == "/landing"
    assert funnel_population(summaries, []).empty


def test_attributes_can_precede_window_but_funnel_steps_cannot():
    start = pd.Timestamp("2025-01-01T01:30Z")
    events = [{"visitor": "a", "ts": start - pd.Timedelta(minutes=1), "name": "pageview", "path": "/", "referrer": "early"},
              {"visitor": "a", "ts": start, "name": "paid", "path": "/", "referrer": "late"}]
    summary = summarize_visitors(events, start, start + pd.Timedelta(hours=1))
    assert summary[0]["referrer"] == "early"
    assert funnel_population(summary, [STEPS[0], STEPS[3]]).empty
    assert len(funnel_population(summary, [STEPS[3]])) == 1


def test_odds_ratio_ci_fisher_and_minimum_samples():
    frame = pd.DataFrame({"device": ["desktop"] * 100 + ["mobile"] * 100, "converted": [True] * 60 + [False] * 40 + [True] * 20 + [False] * 80})
    for dimension in ("referrer", "path", "country", "browser"):
        frame[dimension] = None
    result = conversion_drivers(frame)
    desktop = next(row for row in result if row["value"] == "desktop")
    expected_or = 60.5 * 80.5 / (40.5 * 20.5)
    assert desktop["oddsRatio"] == pytest.approx(expected_or)
    assert 1 < desktop["ciLow"] < expected_or < desktop["ciHigh"]
    assert desktop["q"] == pytest.approx(fisher_exact([[60, 40], [20, 80]]).pvalue)
    assert desktop["rate"] == 0.6 and desktop["restRate"] == 0.2
    assert conversion_drivers(frame.iloc[:29]) == []
    small_group = frame.copy()
    small_group["device"] = ["desktop"] * 29 + ["mobile"] * 171
    assert conversion_drivers(small_group) == []
    assert conversion_drivers(frame.assign(converted=False)) == []


def test_bh_adjustment_and_invalid_values():
    np.testing.assert_allclose(bh_qvalues([0.01, 0.04, 0.03, 0.8]), [0.04, 0.053333333, 0.053333333, 0.8])
    assert len(bh_qvalues([])) == 0
    with pytest.raises(ValueError):
        bh_qvalues([np.nan])


def test_real_twofold_conversion_effect_is_found():
    drivers = conversion_drivers(simulate_population(5000, 2, np.random.default_rng(17)))
    desktop = next(row for row in drivers if row["dimension"] == "device" and row["value"] == "desktop")
    assert desktop["direction"] == "better" and desktop["q"] < 0.1
    assert sum(row["direction"] == "better" for row in drivers) <= 5
    assert sum(row["direction"] == "worse" for row in drivers) <= 5


def test_repeated_all_null_funnels_do_not_show_spurious_drivers_often():
    rng = np.random.default_rng(851)
    trials = 200
    false = sum(bool(conversion_drivers(simulate_population(1000, 1, rng))) for _ in range(trials))
    # Finite Monte Carlo tolerance around the 10% target; report uses 500 trials.
    assert false / trials <= 0.14, f"all-null false-driver rate={false / trials:.1%}"


def test_person_day_engagement_and_bounce_definitions():
    at = pd.Timestamp("2025-01-01T00:00Z")
    events = [{"visitor": visitor, "ts": at + pd.Timedelta(seconds=n), "name": name, "path": "/"}
              for visitor, names in {"one-page": ["pageview"], "paid": ["pageview", "paid"], "two-pages": ["pageview", "pageview"], "custom-only": ["paid"]}.items()
              for n, name in enumerate(names)]
    summary = {row["visitor"]: row for row in summarize_visitors(events)}
    assert summary["one-page"]["bounce"] and not summary["one-page"]["engaged"]
    assert summary["paid"]["bounce"] and summary["paid"]["engaged"]
    assert not summary["two-pages"]["bounce"] and summary["two-pages"]["engaged"]
    assert summary["custom-only"]["path"] is None and summary["custom-only"]["engaged"]
