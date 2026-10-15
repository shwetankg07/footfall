from __future__ import annotations

import argparse
import json
import logging
import os
from pathlib import Path

os.environ.setdefault("MPLCONFIGDIR", "/tmp/footfall-matplotlib")

import matplotlib

matplotlib.use("Agg")
import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from .detect import COVERAGE, detect
from .models import MODEL_TYPES, make_model
from .synth import LEVELS, AnomalyWindow, Traffic, generate

LOG = logging.getLogger(__name__)
ROOT = Path(__file__).resolve().parents[1]


def event_metrics(alerts: dict[pd.Timestamp, str], windows: tuple[AnomalyWindow, ...]) -> dict[str, float]:
    caught = sum(any(window.start <= hour < window.end and kind == window.kind for hour, kind in alerts.items()) for window in windows)
    false = sum(not any(window.start <= hour < window.end and kind == window.kind for window in windows) for hour, kind in alerts.items())
    return {"caught": caught, "windows": len(windows), "false": false}


def evaluate(traffic: Traffic, model_name: str, warmup_days: int = 21, timezone: str = "Asia/Kolkata") -> tuple[dict[str, float], pd.DataFrame]:
    y = traffic.frame["count"]
    folds = []
    alerts: dict[pd.Timestamp, str] = {}
    for cutoff in range(warmup_days * 24, len(y), 24):
        train = y.iloc[:cutoff]
        hours = y.index[cutoff : cutoff + 24]
        model = make_model(model_name).fit(train, timezone)
        forecast = model.predict(hours)
        frame = forecast.frame.copy()
        frame["actual"] = y.loc[hours]
        frame["error"] = np.abs(frame.actual - frame.expected)
        seasonal_scale = float(np.abs(train - train.shift(168)).dropna().mean())
        frame["scaled_error"] = frame.error / max(seasonal_scale, 1.0)
        frame["alert"] = False
        for hour, row in frame.iterrows():
            decision = detect(int(row.actual), row.expected, row.lo, row.hi, forecast.dispersion, rule=forecast.rule)
            if decision:
                alerts[hour] = decision.kind
                frame.loc[hour, "alert"] = True
        folds.append(frame)
    predictions = pd.concat(folds)
    windows = tuple(w for w in traffic.windows if w.start >= predictions.index[0] and w.end <= predictions.index[-1] + pd.Timedelta(hours=1))
    normal = traffic.frame.loc[predictions.index, "label"] == "normal"
    stats = event_metrics(alerts, windows)
    stats.update({
        "mae": float(predictions.error.mean()),
        "mase": float(predictions.scaled_error.mean()),
        "coverage": float(((predictions.actual >= predictions.lo) & (predictions.actual <= predictions.hi))[normal].mean()),
        "hours": len(predictions),
        "normal_hours": int(normal.sum()),
    })
    return stats, predictions


def summarize(results: pd.DataFrame, by: list[str]) -> pd.DataFrame:
    grouped = results.groupby(by, sort=False)
    result = grouped[["mae", "mase", "coverage"]].mean()
    totals = grouped[["caught", "windows", "false", "hours", "normal_hours"]].sum()
    result = result.join(totals)
    result["precision"] = result.caught / (result.caught + result["false"]).clip(lower=1)
    result["recall"] = result.caught / result.windows.clip(lower=1)
    result["f1"] = 2 * result.precision * result.recall / (result.precision + result.recall).clip(lower=1e-12)
    return result


def table(summary: pd.DataFrame) -> str:
    lines = ["| Scenario / method | MAE | MASE | Precision | Recall | F1 | Normal coverage | False alerts |", "|---|---:|---:|---:|---:|---:|---:|---:|"]
    for key, row in summary.iterrows():
        label = " / ".join(key) if isinstance(key, tuple) else str(key)
        lines.append(f"| {label} | {row.mae:.2f} | {row.mase:.3f} | {row.precision:.3f} | {row.recall:.3f} | {row.f1:.3f} | {row.coverage:.1%} | {int(row['false'])} |")
    return "\n".join(lines)


def plot_week(traffic: Traffic, predictions: pd.DataFrame, model: str, destination: Path) -> None:
    week = predictions.iloc[:168]
    fig, ax = plt.subplots(figsize=(14, 5), layout="constrained")
    ax.fill_between(week.index, week.lo, week.hi, color="#b2d5eb", alpha=0.7, label="99% count prediction interval")
    ax.plot(week.index, week.expected, color="#126185", linewidth=1.5, label="Expected")
    ax.plot(week.index, week.actual, color="#25343b", linewidth=1.0, label="Actual pageviews")
    kinds_seen = set()
    for window in traffic.windows:
        if window.end <= week.index[0] or window.start > week.index[-1]:
            continue
        label = f"Injected {window.kind}" if window.kind not in kinds_seen else None
        kinds_seen.add(window.kind)
        ax.axvspan(window.start, window.end, color="#e99934" if window.kind == "spike" else "#aa79bf", alpha=0.27, label=label)
    alerted = week.loc[week.alert]
    ax.scatter(alerted.index, alerted.actual, color="#c93232", marker="x", s=55, zorder=5, label="Alerts")
    ax.set(title=f"Low traffic (~2 views/hour): {model}, held-out week", ylabel="Pageviews per UTC hour", xlabel="UTC date; seasonal features use Asia/Kolkata")
    ax.set_ylim(bottom=0)
    ax.xaxis.set_major_locator(mdates.DayLocator())
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %d"))
    ax.spines[["top", "right"]].set_visible(False)
    ax.grid(axis="y", alpha=0.15)
    ax.legend(loc="upper left", ncol=3, frameon=False, fontsize=9)
    fig.savefig(destination, dpi=160)
    plt.close(fig)


def run_backtest(seeds: list[int], days: int = 35, warmup_days: int = 21, output: Path = ROOT / "reports") -> pd.DataFrame:
    if warmup_days < 14 or days < warmup_days + 7 or not seeds:
        raise ValueError("need >=14 training days, >=7 evaluation days, and at least one seed")
    results = []
    plot_data: dict[str, pd.DataFrame] = {}
    plot_traffic = None
    for level in LEVELS:
        for seed in seeds:
            traffic = generate(days=days, level=level, seed=seed, anomaly_start_day=warmup_days)
            for model_name in MODEL_TYPES:
                LOG.info("scenario=%s seed=%s model=%s", level, seed, model_name)
                stats, predictions = evaluate(traffic, model_name, warmup_days)
                results.append(stats | {"level": level, "seed": seed, "model": model_name})
                if level == "low" and seed == seeds[0]:
                    plot_traffic = traffic
                    plot_data[model_name] = predictions
    raw = pd.DataFrame(results)
    overall = summarize(raw, ["model"])
    per_level = summarize(raw, ["level", "model"])
    # Give sparse and busy sites equal weight; don't let high traffic dominate MAE.
    ranked = per_level.groupby("model")[["f1", "mase"]].mean()
    ranked = ranked.drop(index="naive_threshold")
    chosen = str(ranked.sort_values(["f1", "mase"], ascending=[False, True]).index[0])
    output.mkdir(parents=True, exist_ok=True)
    raw.to_csv(output / "backtest.csv", index=False)
    selection = {
        "model": chosen, "criterion": "highest macro F1 across traffic levels; tie-break lower MASE",
        "seeds": seeds, "days": days, "warmup_days": warmup_days,
        "macro_f1": float(ranked.loc[chosen, "f1"]), "macro_mase": float(ranked.loc[chosen, "mase"]),
    }
    (ROOT / "footfall_ml" / "selection.json").write_text(json.dumps(selection, indent=2) + "\n")
    plot_week(plot_traffic, plot_data[chosen], chosen, output / "backtest.png")
    best_forecast = str(overall.mase.idxmin())
    boost = overall.loc["poisson_boosting"]
    profile = overall.loc["seasonal_profile"]
    report = f"""# Footfall walk-forward backtest

Production selection: **{chosen}**, selected by macro event F1 across low, medium and high traffic; lower MASE breaks a tie. Lowest aggregate MASE: **{best_forecast}**. Choosing the detector and choosing the smallest point error need not produce the same winner.

{table(overall)}

## By traffic level

{table(per_level)}

## What these numbers mean

- {len(seeds)} seeds ({', '.join(map(str, seeds))}) × 3 levels (~2, ~20, ~200 pageviews/hour), {days} days each; first {warmup_days} days train, remaining {days - warmup_days} days evaluate. Every 24 hours we refit on preceding observations, forecast the full next 24 hours, and score without reading future actuals. Lag and rolling features are causal and recursive within a forecast horizon. Labels are used only for evaluation. Operational scoring runs hourly, so this daily-origin experiment is more conservative about forecast freshness.
- The first training period is clean; subsequent histories include previous injected anomalies. There are eight windows per scenario: four spikes (3–6×, 1–3h), four drops (0–15% of normal, 2–6h). Noise is NB2 with dispersion 0.12, plus weekly seasonality, a slow trend and daily variation. This is a synthetic benchmark, not evidence of performance on real customers.
- MAE includes anomaly hours. MASE scales each fold's absolute errors by the mean absolute seasonal-naive error (lag 168) **on that fold's training data**, floored at 1 view. Values below 1 beat that training benchmark; seasonal naive is not forced to equal 1 on unseen data. Aggregate MAE mixes levels and is dominated by busy sites; selection gives the three levels equal weight.
- A window is a true positive if any hour in it alerts in the correct direction; repeated alerts within it count once. False positives are individual alert hours outside a matching window (including wrong-direction alerts). Precision = caught windows / (caught windows + false alert hours). Recall includes every injected window, including tiny low-traffic drops that are intentionally unalertable. F1 is the harmonic mean. This window metric is intentionally different from per-hour classification.
- Bands are central {COVERAGE:.0%} **prediction intervals for a count**, not confidence intervals for its mean: NB2, or Poisson when estimated overdispersion is zero. Normal coverage excludes injected windows and is averaged across scenarios. Discreteness can make coverage exceed nominal. The profile estimates dispersion from daily-origin out-of-sample residuals over the most recent week; with less than two weeks of history it uses in-sample residuals with an approximate fit degrees-of-freedom adjustment. Other models use residual moments, with the same adjustment for fitted point predictors. Squared residuals are bounded so a few spikes cannot set the entire band. This is not a guarantee of calibration under drift.
- Every detector needs an absolute effect of at least 8 views; drops also need expected ≥10. Count-based detectors require an inclusive one-sided tail ≤0.005 and an observation strictly outside the band. The naive threshold deliberately uses >2× / <0.5× trailing seven-day mean with the same effect guards but **no tail gate**; its plotted bands remain count-based for comparison. Its false alarms expose the ratio rule's weakness.

## Reading the result

The selected **{chosen}** achieved macro F1 {ranked.loc[chosen, 'f1']:.3f} and macro MASE {ranked.loc[chosen, 'mase']:.3f}. The seasonal profile pools sparse hours into a smooth hour-of-day × weekday prior, then adds a shrunk hour-of-week profile, recency weighting and a recent level adjustment. This avoids treating one noisy count from last week as a precise expectation.

Poisson boosting achieved aggregate MASE {boost.mase:.3f} and F1 {boost.f1:.3f}; the profile achieved {profile.mase:.3f} and {profile.f1:.3f}. Boosting recall was {boost.recall:.3f}, versus the profile's {profile.recall:.3f}; this increased sensitivity came with {int(boost['false'])} false alert hours versus {int(profile['false'])}. The table records where the more flexible model loses as well as where it wins. Few weeks of sparse counts are limited training data for trees; lag values also carry noise and previous anomalies. Poisson **training loss** does not imply Poisson predictive variance: boosting still uses residual-estimated NB bands.

Low-traffic recall is deliberately limited. A move from 2 to 6 is below the absolute effect guard; a drop to zero at a tiny expected count carries little evidence. No Gaussian z-scores or forced alerts are used to inflate recall. Holt-Winters was omitted: another seasonal point predictor would not address the central count-uncertainty problem, and was not evaluated; no claim is made that it empirically lost.

Next validation: frozen hold-out seeds, real opt-in site histories, interval calibration by traffic level and lead time, and sensitivity to dispersion and changing weekly patterns. The chosen method and synthetic scores use the same scenarios, so these are development results, not an independent final estimate.

![A held-out low-traffic week with honest forecast bands, injected windows and alerts](backtest.png)

Reproduce from `ml/`: `python -m footfall_ml.backtest --seeds {' '.join(map(str, seeds))} --days {days} --warmup-days {warmup_days}`. All numerical rows are also in `backtest.csv`. Model selection is saved in `footfall_ml/selection.json`, which the hourly scorer reads.
"""
    (output / "backtest.md").write_text(report)
    print(table(overall))
    print(f"\nProduction model: {chosen} (macro F1={ranked.loc[chosen, 'f1']:.3f})")
    return overall


def main() -> None:
    parser = argparse.ArgumentParser(description="Reproducible daily-origin walk-forward benchmark")
    parser.add_argument("--seeds", nargs="+", type=int, default=[7, 19, 41])
    parser.add_argument("--days", type=int, default=35)
    parser.add_argument("--warmup-days", type=int, default=21)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    run_backtest(args.seeds, args.days, args.warmup_days)


if __name__ == "__main__":
    main()
