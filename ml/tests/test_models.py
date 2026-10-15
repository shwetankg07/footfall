import numpy as np
import pandas as pd
import pytest

from footfall_ml.models import MODEL_TYPES, SeasonalProfile, make_model, validate_history
from footfall_ml.synth import generate


@pytest.mark.parametrize("name", MODEL_TYPES)
@pytest.mark.parametrize("start", ["2025-01-06T00:00Z", "2025-01-06T00:30Z"])
def test_models_have_valid_count_bands_and_causal_forecasts(name, start):
    traffic = generate(days=28, start=start, anomalies=False)
    history = traffic.frame["count"].iloc[:21 * 24]
    hours = traffic.frame.index[21 * 24 : 22 * 24]
    model = make_model(name).fit(history)
    first = model.predict(hours)
    assert first.frame.index.equals(hours)
    assert (first.frame.lo >= 0).all()
    assert (first.frame.hi >= first.frame.lo).all()
    assert np.isfinite(first.frame).all().all()
    assert (first.frame.lo == np.floor(first.frame.lo)).all()
    # Mutating data after the origin cannot change this fitted model's output.
    traffic.frame.loc[hours, "count"] = 100000
    pd.testing.assert_frame_equal(first.frame, model.predict(hours).frame)
    with pytest.raises(ValueError):
        model.predict(pd.DatetimeIndex([history.index[-1]]))
    with pytest.raises(ValueError, match="align"):
        model.predict(hours + pd.Timedelta(minutes=15))


@pytest.mark.parametrize("timezone", ["Asia/Kolkata", "America/New_York"])
def test_local_seasonality_and_dst_use_contiguous_utc_hours(timezone):
    traffic = generate(days=28, start="2025-02-24T00:00:00Z", timezone=timezone, anomalies=False)
    model = SeasonalProfile().fit(traffic.frame["count"].iloc[:21 * 24], timezone)
    prediction = model.predict(traffic.frame.index[21 * 24 :])
    assert len(prediction.frame) == 168
    assert prediction.frame.index.tz is not None


@pytest.mark.parametrize("level", ["low", "medium", "high"])
def test_nominal_interval_coverage_on_unseen_synthetic_counts(level):
    inside = []
    for seed in [101, 202, 303]:
        data = generate(days=35, level=level, seed=seed, anomalies=False).frame["count"]
        for cutoff in range(28 * 24, len(data), 24):
            prediction = SeasonalProfile().fit(data.iloc[:cutoff]).predict(data.index[cutoff : cutoff + 24]).frame
            actual = data.loc[prediction.index]
            inside.extend(((actual >= prediction.lo) & (actual <= prediction.hi)).tolist())
    # Discrete low counts overcover; fitted intervals may miss by a few points.
    assert 0.965 <= np.mean(inside) <= 1.0, f"{level} coverage={np.mean(inside):.3f}"


def test_history_rejects_missing_hours_and_negative_counts():
    history = generate(days=7, anomalies=False).frame["count"]
    with pytest.raises(ValueError):
        validate_history(history.drop(history.index[12]))
    history.iloc[0] = -1
    with pytest.raises(ValueError):
        validate_history(history)
