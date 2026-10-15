import pandas as pd

from footfall_ml.backtest import event_metrics
from footfall_ml.synth import AnomalyWindow


def test_windows_collapse_repeated_alerts_and_count_false_hours():
    start = pd.Timestamp("2025-01-01T00:00:00Z")
    windows = (AnomalyWindow(start, start + pd.Timedelta(hours=3), "spike", 4), AnomalyWindow(start + pd.Timedelta(hours=6), start + pd.Timedelta(hours=8), "drop", 0))
    alerts = {start: "spike", start + pd.Timedelta(hours=1): "spike", start + pd.Timedelta(hours=4): "spike", start + pd.Timedelta(hours=6): "spike"}
    assert event_metrics(alerts, windows) == {"caught": 1, "windows": 2, "false": 2}
