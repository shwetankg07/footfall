import numpy as np
import pytest

from footfall_ml.detect import count_interval, detect


def decision(actual, expected, dispersion=0.12):
    lo, hi = count_interval(np.array([expected]), dispersion)
    return detect(actual, expected, lo[0], hi[0], dispersion)


def test_small_count_noise_and_clear_spike():
    assert decision(6, 2) is None
    assert decision(9, 2) is None
    result = decision(38, 11)
    assert result.kind == "spike"
    assert result.score < 0.005
    assert decision(0, 2) is None
    assert decision(0, 9) is None
    assert decision(0, 20).kind == "drop"


def test_tail_includes_observed_count_and_is_discrete():
    lo, hi = count_interval(np.array([11.0]), 0.12)
    assert detect(int(hi[0]), 11, lo[0], hi[0], 0.12) is None
    result = detect(int(hi[0]) + 1, 11, lo[0], hi[0], 0.12)
    assert result is not None
    assert result.score <= 0.005


def test_stored_interval_has_conservative_probability_bound():
    lo, hi = count_interval(np.array([11.0]), 0.12)
    result = detect(38, 11, lo[0], hi[0])
    assert result.kind == "spike"
    assert result.score == pytest.approx(0.005)


def test_poisson_limit_and_invalid_data():
    lo, hi = count_interval(np.array([0.0, 2.0, 20.0]), 0)
    assert lo[0] == hi[0] == 0
    assert np.all(lo >= 0)
    assert np.all(hi >= lo)
    with pytest.raises(ValueError):
        detect(-1, 2, 0, 10, 0.1)
    with pytest.raises(ValueError):
        detect(20, 2, 10, 1, 0.1)
