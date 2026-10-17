from __future__ import annotations

import argparse
from math import sqrt
from pathlib import Path

import numpy as np
import pandas as pd

from .funnels import conversion_drivers

REPORT = Path(__file__).resolve().parents[1] / "reports" / "drivers.md"


def simulate_population(n: int, ratio: float, rng: np.random.Generator) -> pd.DataFrame:
    desktop = rng.random(n) < 0.5
    return pd.DataFrame({
        "device": np.where(desktop, "desktop", "mobile"),
        "referrer": rng.choice([None, "google.com", "linkedin.com", "wa.me"], n),
        "path": rng.choice(["/", "/products", "/blog/launch"], n),
        "country": rng.choice(["IN", "US", "GB"], n),
        "browser": rng.choice(["Chrome", "Safari", "Firefox"], n),
        "converted": rng.random(n) < np.where(desktop, 0.15 * ratio, 0.15),
    })


def wilson(successes: int, trials: int) -> tuple[float, float]:
    z, p = 1.959963984540054, successes / trials
    denominator = 1 + z**2 / trials
    center = (p + z**2 / (2 * trials)) / denominator
    half = z * sqrt(p * (1 - p) / trials + z**2 / (4 * trials**2)) / denominator
    return center - half, center + half


def run_simulation(repeats: int = 200, null_repeats: int = 500, seed: int = 20261017) -> pd.DataFrame:
    if repeats < 1 or null_repeats < 1:
        raise ValueError("simulation counts must be positive")
    rng = np.random.default_rng(seed)
    rows = []
    for n in (200, 1000, 5000):
        for ratio in (1.5, 2.0):
            detected = 0
            for _ in range(repeats):
                drivers = conversion_drivers(simulate_population(n, ratio, rng))
                detected += any(row["dimension"] == "device" and row["value"] == "desktop" and row["direction"] == "better" for row in drivers)
            lo, hi = wilson(detected, repeats)
            rows.append({"entered": n, "trueRateRatio": ratio, "detected": detected, "trials": repeats, "power": detected / repeats, "ciLow": lo, "ciHigh": hi})
    false = sum(bool(conversion_drivers(simulate_population(1000, 1.0, rng))) for _ in range(null_repeats))
    null_low, null_high = wilson(false, null_repeats)
    lines = ["# Funnel driver simulation", "", f"Seed {seed}; {repeats} repeats per power cell; {null_repeats} all-null funnels. The production `conversion_drivers` function is used unchanged.", "", "| Entered | True desktop rate ratio | Found / trials | Power | 95% Monte Carlo interval |", "|---:|---:|---:|---:|---:|"]
    for row in rows:
        lines.append(f"| {row['entered']} | {row['trueRateRatio']:.1f}× | {row['detected']} / {row['trials']} | {row['power']:.1%} | {row['ciLow']:.1%}–{row['ciHigh']:.1%} |")
    lines += ["", f"All-null false-driver rate: **{false}/{null_repeats} = {false / null_repeats:.1%}** (95% Wilson interval {null_low:.1%}–{null_high:.1%}); BH target q < 10%.", "", "Visitors are independent person-days, half desktop. Baseline conversion probability is 15%; desktop is 22.5% or 30%, so these are true **risk ratios**, not odds ratios. Referrer, entry page, country and browser are independently assigned, have no causal effect, and are tested alongside both device values. The same minimum 30 inside/outside rule, two-sided Fisher tests, BH correction across every eligible attribute value, and five-per-direction display cap are applied.", "", "Power is the proportion of runs where the displayed desktop/better driver is found. The null measure is the proportion of funnels with any displayed false driver. Under the complete null, every discovery is false, so this estimates FDR itself (also family-wise error), rather than the misleading fraction of individual tests that reject. Monte Carlo intervals describe uncertainty from the finite simulation, not uncertainty in a customer insight.", "", "Small samples can have low power even when a real effect exists. Large sample sizes help; absence of a driver is not evidence of equal conversion. These trials do not establish FDR control under arbitrary dependence, repeated daily monitoring, across multiple funnels, or partial-null mixtures. Real attributes are correlated, and these are associations, not proof that changing an attribute causes conversion. Displayed odds-ratio confidence intervals use the +0.5 Haldane correction and normal log-OR approximation; they are not adjusted for selection or multiple comparisons.", "", f"Reproduce from `ml/`: `python -m footfall_ml.drivers_simulation --repeats {repeats} --null-repeats {null_repeats} --seed {seed}`."]
    REPORT.write_text("\n".join(lines) + "\n")
    result = pd.DataFrame(rows)
    result.to_csv(REPORT.with_suffix(".csv"), index=False)
    print(result.to_string(index=False, float_format=lambda x: f"{x:.4f}"))
    print(f"Null: {false}/{null_repeats} = {false / null_repeats:.1%} (95% CI {null_low:.1%}–{null_high:.1%})")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate conversion-driver power and all-null false discovery")
    parser.add_argument("--repeats", type=int, default=200)
    parser.add_argument("--null-repeats", type=int, default=500)
    parser.add_argument("--seed", type=int, default=20261017)
    args = parser.parse_args()
    run_simulation(args.repeats, args.null_repeats, args.seed)


if __name__ == "__main__":
    main()
