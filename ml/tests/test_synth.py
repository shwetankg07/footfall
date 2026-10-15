import pandas as pd
import pytest

from footfall_ml.synth import generate


def test_deterministic_counts_and_labels():
    first, second = generate(seed=19), generate(seed=19)
    pd.testing.assert_frame_equal(first.frame, second.frame)
    assert first.windows == second.windows
    assert not first.frame["count"].equals(generate(seed=20).frame["count"])
    assert len(first.windows) == 8
    assert set(first.frame.label) == {"normal", "spike", "drop"}
    for window in first.windows:
        selected = (first.frame.index >= window.start) & (first.frame.index < window.end)
        assert (first.frame.loc[selected, "label"] == window.kind).all()
        pd.testing.assert_series_equal(
            first.frame.loc[selected, "mean"],
            (first.frame.loc[selected, "normal_mean"] * window.factor).rename("mean"),
        )
        duration = (window.end - window.start).total_seconds() / 3600
        assert (1 <= duration <= 3) if window.kind == "spike" else (2 <= duration <= 6)
        assert (3 <= window.factor <= 6) if window.kind == "spike" else (0 <= window.factor <= 0.15)


def test_synthetic_low_medium_high_and_no_anomalies():
    for level, target in [("low", 2), ("medium", 20), ("high", 200)]:
        traffic = generate(level=level, days=56, anomalies=False)
        assert traffic.frame["count"].mean() == pytest.approx(target, rel=0.1)
        assert not traffic.windows
        assert (traffic.frame.label == "normal").all()
        assert (traffic.frame["count"] >= 0).all()
