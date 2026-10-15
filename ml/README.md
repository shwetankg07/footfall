# Footfall ML

Hourly pageview forecasts and count-aware anomaly detection. The production model is a **recency-weighted seasonal profile** selected by a reproducible synthetic walk-forward benchmark. Everything here runs independently of the Express and React applications.

## Run locally

Python **3.12** and [uv](https://docs.astral.sh/uv/) are required. From the repository root:

```bash
cd ml
uv venv --python 3.12 .venv
uv pip install -r requirements.txt
source .venv/bin/activate
python -m pytest
python -m footfall_ml.backtest
```

Dependencies are pinned in `requirements.txt`; the local environment is gitignored. Tests and the backtest need no network or database. In restricted environments, set `UV_CACHE_DIR=/tmp/footfall-uv-cache` and `UV_PYTHON_INSTALL_DIR=/tmp/footfall-python` before the uv commands.

```bash
export MONGO_URI='mongodb://localhost:27017'
export MONGO_DB='footfall'
export API_URL='http://localhost:8080'
export INTERNAL_SECRET='use-the-same-secret-as-the-server'

python -m footfall_ml.score --dry-run
python -m footfall_ml.score
python -m footfall_ml.score --site 0123456789abcdef01234567
```

| Environment variable | Meaning |
|---|---|
| `MONGO_URI` | Required MongoDB connection string. Missing configuration prints a clear message and exits 2, including with `--dry-run`. |
| `MONGO_DB` | Database name, default `footfall`. Always selected using `client[db_name]`; any database in the URI is ignored. |
| `API_URL` | Optional server base URL. After scoring, POST `/internal/alerts/flush` with JSON `{}`. |
| `INTERNAL_SECRET` | Sent as `x-internal-secret`; must match the server. If absent, flush is skipped with a warning. |

`--dry-run` reads and computes, and logs candidate alerts. It writes no forecasts, alerts or indexes and sends no HTTP request. Individual site failures are logged and other sites continue. Connection/index setup failures exit 1. A failed notification flush is logged and exits 0; unnotified alerts remain available for the next run. The Python entry point does not load `.env` files: export variables in your shell or inject them in the workflow.

## Seed a demo and populate its chart

Create a demo site through the app first, then use its existing ObjectId:

```bash
python -m footfall_ml.seed_demo --site 0123456789abcdef01234567 --days 28 --replace
python -m footfall_ml.score --site 0123456789abcdef01234567 --backfill-days 21
```

The seeder writes individual event documents, about 20 pageviews/hour, ending at the last completed hour in the site's timezone. It adds three 3–6× spikes, realistic device/referrer/country mixes (mostly India), and shop sessions with decreasing participation through `/` → `/products` → `/product/<slug>` → `/cart` → `/checkout` → custom `paid` events. Paid events are separate from pageviews. Fake visitors have SHA-256 hex identities that stay stable for the same fake person on a local calendar day and rotate the next day. The hourly pageview totals exactly match the synthetic counts on those local-hour buckets.

Existing events are replaced only with `--replace`; without it, a nonempty site is refused. Only that site's events are deleted; existing forecasts and alerts are preserved. Use a fresh demo site for a completely fresh presentation. Given the same seed and hourly start, the generated events are deterministic; the CLI anchors the end to the site's current local-hour start, represented in UTC. The synthetic generator preserves the supplied first bucket, including `:30` UTC for `Asia/Kolkata`.

Backfill explicitly replays each historical hourly origin on that site's local-hour boundaries, training only on observations before that origin. It inserts missing historical forecasts and alerts; **existing historical forecasts are never overwritten**. Historical `updatedAt` records the simulated issue time. These are retrospective model outputs, not forecasts actually issued at that historical time. Backfill ends with a normal present-time run. It can be rerun safely. Backfill alerts are eligible for the same notification flush; use the demo server URL or leave `API_URL` unset while preparing a presentation.

## Model and detection

`models.py` exposes `fit(hourly_counts, timezone)` → `predict(UTC_hours)`. Each timestamp is the UTC instant of a site-local hour start; the forecast grid must retain the training grid's hourly offset. Each forecast contains expected counts and integer bounds of a central 99% predictive interval. Count variance is `mu + alpha * mu**2` (negative binomial NB2), falling back to Poisson at zero estimated overdispersion. These are intervals for **future observations**, not uncertainty about the mean alone.

Four methods are compared:

1. **Naive threshold:** expected = trailing seven-day mean; benchmark alerts at >2× or <0.5× the mean. The shared effect guards still apply. Its forecast bands use count distributions, but the baseline deliberately has no probability gate.
2. **Seasonal naive:** reuse the most recent matching local hour of the week; handle daylight-saving shifts through local calendar slots.
3. **Seasonal profile:** shrink a 168-hour weekly profile toward a smoothed hour-of-day × weekday prior, weight observations with a 21-day half-life, bound spike influence, and adjust the level using the past week. Dispersion comes from causal daily-origin forecast residuals over the most recent week. With less than two weeks of data it falls back to degrees-of-freedom-adjusted fit residuals, rather than calibrating from only a few held-out hours.
4. **Poisson gradient boosting:** `HistGradientBoostingRegressor(loss="poisson")` using hour-of-week, hour, weekday, cyclic hour, lags 24/168 and preceding rolling means 24/168. Future lag and rolling inputs are recursively predicted, never read from future observations. Residual NB intervals allow more variance than the Poisson training loss alone would imply.

Production alerts require an observation strictly outside the band, inclusive one-sided count tail ≤0.005, and an absolute deviation of at least **8 pageviews**. Drops additionally require expected ≥**10**. Thus 2 → 6 is ignored while 11 → 38 is a spike at a representative dispersion of 0.12. Low-traffic drop recall is deliberately limited. Holt-Winters was omitted to keep the comparison focused; it was not benchmarked and is not claimed to have lost.

The shared forecast schema contains the band but no distribution metadata. To preserve it exactly, scoring a **stored** forecast reports the conservative tail-probability upper bound **0.005** when outside its 99% band. A newly computed fallback reports the exact NB/Poisson tail. Stored scores are tied at the bound; rank stored alerts by effect size if needed. No extra Mongo fields are needed.

## Data and scoring contract

`data.py` is the only Mongo adapter. It reads `sites` and aggregates only `events.name == "pageview"`, using `$dateTrunc` with `timezone` set to the site's IANA timezone, defaulting to `Asia/Kolkata` (MongoDB **5.0+**). Every `hour` in forecasts, alerts, and zero-filled count indexes is the **UTC instant of the start of a local hour**, matching the dashboard. For IST that means `:30` UTC, rather than `:00`. The cutoff is computed by converting to the site timezone, flooring to the local hour, then converting back to UTC. Repeated DST hours retain their distinct UTC instants; nonexistent spring-forward hours are skipped.

The adapter zero-fills every missing local-hour bucket before the scoring cutoff, including hours after the last observed event so outages remain visible. Seasonality uses the same timezone. Partial current local hours are excluded. Queries use the shared `site`/`ts` event index. At most 56 days of counts are loaded; eligibility still checks the actual first event.

At `13:07 UTC` for an `Asia/Kolkata` site, the current local hour started at **12:30 UTC**. A normal run scores **09:30, 10:30 and 11:30 UTC** and forecasts **13:30 through 12:30 UTC tomorrow**. Stored forecasts take precedence, even if the current model differs. If one is missing, the model is fit on data strictly before that target hour. The current local hour is never forecast or scored after it starts.

The adapter creates unique `(site, hour, metric)` indexes on `forecasts` and `alerts`. Future forecasts are upserted, and write guards floor both the issue time and the current write time to site-local hour starts. A job crossing `:30` UTC for an IST site therefore cannot overwrite a forecast for the hour that has just started. Normal runs never update past forecast bands. Alerts use insert-only writes and catch duplicate-key errors, preserving `createdAt`, `notifiedAt` and `readBy` on reruns. All required document field names match the shared contract, including `metric: "pageviews"`.

A site is skipped with a reason until seven days after its first event, or when the past week contains fewer than **84 pageviews** or fewer than **12 nonzero hours**. The production profile can start at seven days; boosting needs at least ten days and remains an evaluated alternative. A scheduled run checks only the last three completed hours; use explicit backfill after a longer interruption.

## Measured results

The generated [report](reports/backtest.md), [raw results](reports/backtest.csv), and [low-traffic chart](reports/backtest.png) come from running `python -m footfall_ml.backtest`. Three seeds × three traffic levels × 35 days; first 21 days train, then 14 days of daily-origin, 24-hour walk-forward forecasts. Selection uses the highest macro event F1 across levels; lower MASE breaks ties. `footfall_ml/selection.json` is generated from those results and read by the scorer.

| Method | MAE | MASE | Precision | Recall | F1 | False alert hours |
|---|---:|---:|---:|---:|---:|---:|
| Naive threshold | 55.62 | 1.381 | 0.070 | 0.722 | 0.127 | 696 |
| Seasonal naive | 47.84 | 1.284 | 0.341 | 0.611 | 0.438 | 85 |
| **Seasonal profile** | **36.21** | **0.969** | **0.904** | 0.653 | **0.758** | **5** |
| Poisson boosting | 40.01 | 1.046 | 0.472 | 0.708 | 0.567 | 57 |

The profile wins point error and F1. Boosting has better recall, but produces many more false alarms. Profile MASE is 0.855 on low traffic and 0.945 on medium traffic; **1.107 on high traffic** shows it does not always beat the fold's training seasonal-naive error scale. The profile's normal-hour band coverage is 99.8% in this anomaly-contaminated benchmark; wide bands trade some sensitivity for precision.

MASE divides each fold's error by its training lag-168 seasonal-naive MAE, floored at one view. An injected window counts once if any hour alerts in the correct direction; alerts outside matching windows are false alert hours. Precision therefore compares caught windows with false alert hours. The report gives full definitions and level-specific results. The 72 windows include low-traffic drops below the deliberate alertability threshold.

These are development scores on synthetic data used for model selection. The coverage regression also uses separate clean synthetic seeds: observed 99.6%, 99.8%, and 99.0% on low, medium, and high traffic. Calibration was corrected after this check exposed overly narrow fit-residual bands; these regression scenarios are not a final independent evaluation. Real customer validation and frozen hold-out seeds remain future work.

## Automation and tests

`../.github/workflows/ml-score.yml` runs hourly at minute 7 and via `workflow_dispatch`, with Python 3.12, cached pip dependencies, and concurrent jobs serialized. Set repository secrets `MONGO_URI`, `API_URL`, `INTERNAL_SECRET`; optionally set `MONGO_DB` as a repository variable or secret. The workflow defaults to `footfall` when absent.

Tests cover deterministic labels/counts, small-count safeguards and clear spikes, count-band coverage, causal features, IST half-hour bucket alignment, DST transitions, local started-hour guards, per-site backfill origins, database selection, pageview-only zero filling, frozen historical bands, all three completed hours, alert idempotency/status preservation, no-write dry runs, site isolation, failed-flush retry, and the demo event schema/funnel. The data layer is faked in memory; no real MongoDB or HTTP service is used.
