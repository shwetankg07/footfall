import pytest

from footfall_ml.rca import explain_change
from footfall_ml.visitors import DIMENSIONS


def test_linkedin_spike_explains_ninety_percent_of_referrer_change():
    before = {"referrer": {None: 40, "linkedin.com": 10}, "device": {"desktop": 25, "mobile": 25}}
    actual = {"referrer": {None: 45, "linkedin.com": 55}, "device": {"desktop": 50, "mobile": 50}}
    drivers, broad = explain_change(actual, [before] * 4, "spike")
    assert drivers[0] == {"dimension": "referrer", "value": "linkedin.com", "actual": 55, "expected": 10.0, "delta": 45.0, "share": 0.9}
    assert len(drivers) == 3
    assert broad is False


def test_even_sitewide_outage_is_broad():
    before = {dimension: {f"segment-{n}": 10 for n in range(4)} for dimension in DIMENSIONS}
    drivers, broad = explain_change({}, [before, before], "drop")
    assert broad is True
    assert len(drivers) == 3
    assert all(driver["actual"] == 0 and driver["delta"] == -10 and driver["share"] == 0.25 for driver in drivers)


@pytest.mark.parametrize("country_share,desktop_share", [(44, 46), (56, 75), (70, 82)])
@pytest.mark.parametrize("multiplier,kind", [(0, "drop"), (2, "spike")])
def test_uniform_outages_and_surges_are_broad_even_with_dominant_segments(country_share, desktop_share, multiplier, kind):
    before = {"country": {"IN": country_share, "US": 100 - country_share},
              "device": {"desktop": desktop_share, "mobile": 100 - desktop_share},
              "referrer": {None: 89, "google.com": 11}, "path": {"/": 91, "/products": 9},
              "browser": {"Chrome": 96, "Safari": 4}}
    actual = {dimension: {value: count * multiplier for value, count in counts.items()} for dimension, counts in before.items()}
    drivers, broad = explain_change(actual, [before] * 3, kind)
    assert broad is True and len(drivers) == 3
    assert all(driver["share"] == pytest.approx(driver["expected"] / 100) for driver in drivers)


@pytest.mark.parametrize("hn_count,other_sources", [(40, {None: 80, "google.com": 80}), (114, {None: 36, "google.com": 50})])
def test_hacker_news_concentration_outranks_normal_desktop_majority(hn_count, other_sources):
    before = {"referrer": {None: 50, "google.com": 50, "news.ycombinator.com": 0},
              "device": {"desktop": 89, "mobile": 11}, "country": {"IN": 82, "US": 18}}
    actual = {"referrer": other_sources | {"news.ycombinator.com": hn_count},
              "device": {"desktop": 178, "mobile": 22}, "country": {"IN": 164, "US": 36}}
    drivers, broad = explain_change(actual, [before] * 4, "spike")
    assert broad is False
    assert drivers[0] == {"dimension": "referrer", "value": "news.ycombinator.com", "actual": hn_count,
                          "expected": 0.0, "delta": float(hn_count), "share": hn_count / 100}
    if hn_count == 40:
        assert any(abs(driver["delta"]) > hn_count for driver in drivers[1:])


@pytest.mark.parametrize("excess_points,broad", [(25, True), (26, False)])
def test_broad_tolerance_is_twenty_five_percentage_points(excess_points, broad):
    before = {"referrer": {None: 100, "new.example": 0}}
    actual = {"referrer": {None: 200 - excess_points, "new.example": excess_points}}
    assert explain_change(actual, [before, before], "spike")[1] is broad


def test_zero_expected_traffic_does_not_imply_a_known_normal_mix():
    actual = {"referrer": {str(number): 25 for number in range(4)}}
    assert explain_change(actual, [{}, {}], "spike")[1] is False


def test_history_requirement_missing_weeks_and_effect_filter():
    assert explain_change({"referrer": {None: 30}}, [{}], "spike") == ([], False)
    drivers, _ = explain_change({"referrer": {None: 30}}, [{"referrer": {None: 12}}, {}, {}], "spike")
    assert drivers[0]["expected"] == 4
    assert drivers[0]["delta"] == 26
    assert explain_change({"path": {"/": 2}}, [{}, {}], "spike")[0] == []
    assert explain_change({}, [{"path": {"/": 10}}] * 2, "spike") == ([], False)
    with pytest.raises(ValueError):
        explain_change({}, [], "other")


def test_zero_total_change_cannot_create_huge_shares_from_rounded_thirds():
    actual = {"path": {"0": 6, "1": 5, "2": 15, "3": 11}}
    previous = [{"path": {"0": 2, "1": 15, "2": 15, "3": 8}},
                {"path": {"0": 7, "1": 3, "2": 19, "3": 3}},
                {"path": {"0": 9, "1": 3, "2": 15, "3": 12}}]
    assert explain_change(actual, previous, "spike") == ([], False)
    assert explain_change(actual, previous, "drop") == ([], False)
