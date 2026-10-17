# Footfall Intelligence

The Pro analytics jobs: hourly count-aware forecasts and anomaly explanations, daily funnel conversion drivers, and an evidence-based opportunities feed. The production forecasting model is a **recency-weighted seasonal profile** selected by a reproducible synthetic walk-forward benchmark. The free dashboard is implemented separately in Express and React.

## Run locally

Python **3.12** and [uv](https://docs.astral.sh/uv/) are required. From the repository root:

```bash
cd ml
uv venv --python 3.12 .venv
uv pip install -r requirements.txt
source .venv/bin/activate
python -m pytest
python -m footfall_ml.backtest
python -m footfall_ml.drivers_simulation
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
python -m footfall_ml.insights --dry-run
python -m footfall_ml.insights --site 0123456789abcdef01234567
```

| Environment variable | Meaning |
|---|---|
| `MONGO_URI` | Required MongoDB connection string. Missing configuration prints a clear message and exits 2, including with `--dry-run`. |
| `MONGO_DB` | Database name, default `footfall`. Always selected using `client[db_name]`; any database in the URI is ignored. |
| `API_URL` | Optional server base URL. After scoring, POST `/internal/alerts/flush` with JSON `{}`. |
| `INTERNAL_SECRET` | Sent as `x-internal-secret`; must match the server. If absent, flush is skipped with a warning. |

`--dry-run` reads and computes, and logs candidate alerts. It writes no forecasts, alerts or indexes and sends no HTTP request. Individual site failures are logged and other sites continue. Connection/index setup failures exit 1. A failed notification flush is logged and exits 0; unnotified alerts remain available for the next run. The Python entry point does not load `.env` files: export variables in your shell or inject them in the workflow.

## Pro entitlement

Both entry points use `data.MongoRepository.intelligence_sites` to join sites to their owners in two batched queries. An owner is entitled exactly when `proUntil > now` **or** `trialEndsAt > now`. The `plan` label alone grants nothing; missing dates, exact expiry, missing users and missing owners are not entitled. Skipped sites log `skipped: free plan`. Entitlement is checked at the current job time, including before a historical replay; backfill cannot restore expired access.

`users` and ownership are read-only here. Set up a demo owner's Pro expiry or trial through the server. Neither seeding nor the ML jobs changes plans, writes users, or creates sites/funnels.

## Seed a demo and populate its chart

Create a demo site, give its owner an active Pro expiry or trial, and create the shop funnel through the app first. Its steps are page `/`, page `/product/*`, page `/cart`, event `paid`. Then use its existing ObjectId:

```bash
python -m footfall_ml.seed_demo --site 0123456789abcdef01234567 --days 28 --replace
python -m footfall_ml.score --site 0123456789abcdef01234567 --backfill-days 21
python -m footfall_ml.insights --site 0123456789abcdef01234567
```

The seeder writes individual event documents, about 20 pageviews/hour, ending at the last completed hour in the site's timezone. Two 3–6× campaigns are driven mostly by `news.ycombinator.com` and `linkedin.com`; a separate afternoon has a three-hour outage with no events in any segment. Spikes occur late enough in a 28-day demo for weekly attribution. Country, browser and device mixes remain varied, with India the largest country group.

Mobile visitors bounce much more than desktop visitors; `/blog/launch` is a deliberately leaky entry page. After reaching checkout, LinkedIn visitors pay with probability 90% versus 45% for other sources, producing about twice the full-funnel conversion rate, with finite-sample variation. Shop visits proceed through `/` → `/products` → `/product/<slug>` → `/cart` → `/checkout` → custom `paid`; blog visitors may bounce before entering the shop funnel. Times strictly increase within a visit. Each fake visit has a separate person-day hash, preventing accidental cross-session funnel completion. Hashes are SHA-256 hex, stable per fake person on a local calendar day and rotated the next day. The production server rotates at UTC midnight; the analysis groups whichever visitor hashes are present, without reconstructing identities.

Paid events are separate from pageviews, and the pageview totals exactly match the synthetic local-hour counts. Integration tests verify that both campaign sources appear in alert drivers, the outage produces drop alerts including broad attribution, mobile and the blog page produce opportunities, and the LinkedIn conversion association is significant in a default 28-day demo. No insight is hard-coded into the scoring functions.

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

A site is skipped with a reason until seven days after its first event, or when the past week contains fewer than **84 pageviews** or fewer than **12 nonzero hours**. Forecasts start at **seven days**, but alerts require **14 days of history before the hour being judged**, controlled by `score.MIN_ALERT_HISTORY_DAYS`. This extra alert warm-up avoids acting on a profile learned from barely one week of data. The check uses the first event's exact timestamp and applies to stored forecasts, fallback predictions, dry runs and historical backfill; running a replay at day 28 cannot create alerts for days 7–13. Existing alerts are preserved rather than deleted. Boosting needs at least ten days and remains an evaluated alternative. A scheduled run checks only the last three completed hours; use explicit backfill after a longer interruption.

## Why an alert changed

New alerts keep all previous fields and add `drivers` and `broad`. `rca.py` is a pure additive attribution function over pageview counts in referrer, path, device, country and browser. Null referrers stay JSON/BSON null and are displayed as Direct.

For each segment, expected traffic is its mean count in the same **local hour-of-week** over up to four previous weeks. At least two prior weeks of overall history are required. Missing event buckets and nonexistent spring-forward hours count as zero, while weeks before the site's history are excluded. A repeated fall-back hour uses the occurrence matching the target's DST status.

Each driver has `dimension`, `value`, integer `actual`, float `expected`, `delta`, and `share`. Only segments moving with the alert and the dimension's total change are considered; `abs(delta)` must be at least three views. Share is segment delta divided by that dimension's total delta; it can exceed 100% when another segment offsets the movement. Ranking uses **concentration**: that change share minus the segment's normal share of expected traffic in the dimension. The top three across dimensions are ordered by concentration, then absolute delta and change share. A source responsible for 114% of a spike but normally almost no traffic therefore ranks ahead of desktop merely accounting for its usual 89%. Concentration is calculated internally; the stored driver fields stay the same. Dimensions overlap and their shares must not be added together. Their weekly baseline need not equal the recency-weighted alert forecast.

`broad` is true when, in **every informative dimension**, no segment's change share exceeds its expected traffic share by more than **0.25**, or 25 percentage points (`rca.BROAD_SHARE_TOLERANCE`). A uniform outage or proportional surge is broad even when IN or desktop dominates normal traffic. With no expected traffic, there is no known normal mix and broad is false. On a broad alert, the retained drivers describe **participating segments, not causes**; a large segment's share does not explain why the whole site moved. Even concentrated drivers are associations rather than proof of causality. Insufficient history returns `drivers: []`, `broad: false`. Attribution query failures are logged and leave those empty defaults while preserving the anomaly. Existing alerts remain insert-only and are never rewritten on reruns; backfill adds attribution to newly inserted alerts too.

## Funnel conversion drivers

The daily job reads `funnels` and the last **30 elapsed days**, ending at the current local-hour cutoff. Each `visitor` hash is one person-day. Events are sorted by `(ts, _id)`; each event can advance at most one step. A page step requires `name == "pageview"` and an exact path, or a prefix when its value ends in `*`; an event step matches its name. Out-of-order steps do not advance; repeats do not count extra visitors. These rules match `server/utils/funnel.js`. An entrant matched step one, and a converter reached the final step. A one-step funnel has every entrant converted; an empty funnel has no entrants.

Attributes are referrer, device, country, browser, and entry page `path` from the visitor's first pageview, including when that pageview preceded the first funnel step. The adapter loads enough of the first day before the window to retain this metadata, for both UTC and local-day hashes; those earlier events cannot advance the funnel. A custom-event-only entrant has null pageview attributes.

For each attribute value with **at least 30 entrants inside and 30 outside**, the function compares converted/not-converted inside/outside. It reports a +0.5 Haldane-corrected odds ratio and nominal 95% log-OR interval, inside `rate`, outside `restRate`, and a two-sided Fisher exact test. Benjamini–Hochberg correction includes **every eligible attribute-value test in that funnel**, then only `q < 0.1` is shown. At most five better and five worse drivers remain, sorted by absolute log odds ratio. An empty list means no effect cleared those bars. Odds ratios are not rate ratios, and these are observational associations, not causes; correlated attributes may describe the same population. Confidence intervals are not adjusted for multiple comparisons or selection, and daily repeated looks are not a sequential test.

Each result is upserted in `insights` with unique `(site, kind, key)`: `kind: "funnel_drivers"`, `key: str(funnel._id)`, `funnel: ObjectId`, `from`, `to`, `computedAt`, `entered`, `converted`, `rate`, and `drivers`. Driver fields are `dimension`, `value`, `entered`, `converted`, `rate`, `restRate`, `oddsRatio`, `ciLow`, `ciHigh`, `q`, and `direction` (`better`/`worse`). No intermediate p-values or extra visitor identities are persisted.

The reproducible [drivers report](reports/drivers.md) uses 200 simulations per power cell and 500 all-null funnels. At 200 / 1,000 / 5,000 entrants, observed power is **12% / 76% / 100%** for a true 1.5× conversion rate and **52.5% / 100% / 100%** for 2×. The all-null fraction of funnels showing any driver is **7.4%** (37/500; 95% Monte Carlo interval 5.4%–10.0%), compared with the 10% BH target. The baseline rate is 15%, and these development simulations do not validate arbitrary attribute dependence, partial-null mixtures, or repeated daily monitoring. The report and CSV give finite-simulation intervals; 100% observed power is not a guarantee.

## Opportunities feed

The daily job also upserts one `insights` document per site with `kind: "opportunities"`, `key: "site"`, `from`, `to`, `computedAt`, and `items`. The observation window is the last **28 elapsed days**, ending at the same local-hour cutoff. Only person-days with a pageview enter these comparisons. Bounce means exactly one pageview; engaged means at least two pageviews **or any custom event**. A one-page visit with a custom event can therefore be both a bounce by this definition and engaged.

| Type | Evidence bar | Impact score |
|---|---|---|
| `leaky_page` | Entry page with ≥50 entrants and ≥50 outside it; bounce rate higher than outside, one-sided pooled two-proportion z-test, BH q < 0.05 within entry-page tests | Weekly entrances × (page bounce rate − site bounce rate) |
| `strong_source` | Referrer with ≥50 visitors and ≥50 outside; engaged rate higher than outside, same test and within-referrer BH bar | Weekly source visitors × (source engaged rate − site engaged rate) |
| `weak_device` | Device with ≥50 visitors and ≥50 outside; engaged rate lower than outside, same test and within-device BH bar | Weekly device visitors × (outside engaged rate − device engaged rate) |
| `peak_hours` | ≥21 days of hourly history; seasonal profile's three highest nonoverlapping three-hour windows in site-local time | 0, informational |
| `next_week` | Forecast eligibility: ≥7 days and sufficient volume | 0, informational |

The tests compare each segment to the **rest** of the site because testing it against an overlapping site-wide sample would violate independence. Displayed site averages are still used for the specified page/source impact formulas. Z-tests with constant outcomes return no evidence. Correction is within each opportunity family, not across all three families, funnels, sites, or successive days.

Every item has exactly `type`, `title`, `detail`, `impact`, and `metric`. Metrics retain denominators, inside/outside/site rates, p and q, observation days, and lift. Impact is a **ranking proxy assuming the observed gap could be closed**, not a causal prediction or a promised gain. Page impacts estimate extra multi-page person-days per week; source/device impacts estimate extra engaged person-days per week. Different items may describe overlapping visitors, so their impacts must not be summed. Up to eight items are kept by descending impact, reserving room at the end for the informational items. The feed refreshes daily and can be used as a weekly digest.

Peak hours are included with three weeks of history even if there is no distinctive peak; a flat profile says so. Owner-facing copy uses weekday names, ordinary am/pm times and a local timezone label such as IST, grouping days only when their hours match. It describes the busiest times rather than claiming those windows contain a majority of visitors.

`next_week` forecasts the next 168 **not-yet-started** local-hour buckets, compares their expected pageviews with the last 168 completed hours, and includes an 80% count range from 4,000 deterministic-seed Monte Carlo draws using the production model's residual-estimated NB/Poisson noise. It is a **conditional range assuming independent hourly noise**, excludes model/trend uncertainty, and has not been validated for aggregate weekly coverage. Its `metric` includes exact forecast bounds/times and this assumption; it is not computed by adding hourly interval endpoints. The displayed sentence uses “about” and “likely”, rounds counts to roughly three significant digits, and calls a change within 5% “close to last week”; larger changes say more or fewer, and a zero prior total is handled without a percentage comparison. These display changes do not round or alter the stored numeric evidence. Statistical assumptions stay here and in `metric`, not in the owner-facing title/detail.

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

`../.github/workflows/ml-score.yml` runs the scorer at **:35 UTC each hour** and the separate insights job at **21:05 UTC daily (02:35 IST)**. `workflow_dispatch` runs both. Python 3.12, cached pip dependencies, and serialized workflow runs are retained. Set secrets `MONGO_URI` and `INTERNAL_SECRET`, plus `API_URL` as a variable or secret; optionally set `MONGO_DB` as a variable or secret. The database defaults to `footfall`. Daily insights require only MongoDB and send no notification flush.

Tests cover deterministic labels/counts, small-count safeguards and clear spikes, count-band coverage, causal features, IST half-hour bucket alignment, DST transitions, local started-hour guards, per-site backfill origins, database selection, pageview-only zero filling, frozen historical bands, all three completed hours, alert idempotency/status preservation, no-write dry runs, site isolation, failed-flush retry, and the demo event schema/funnel. The data layer is faked in memory; no real MongoDB or HTTP service is used.

Intelligence tests add strict plan expiry/trial rules with batched lookups, hand-built campaign/outage attribution, zero weekly buckets across DST, exact funnel ordering/wildcards and entry metadata, hand-checked odds ratios/Fisher/BH calculations, repeated all-null simulations, opportunity evidence and ranking, deterministic weekly ranges, daily upsert idempotency, and end-to-end demo stories. The existing forecasting benchmark remains unchanged; no new runtime dependency was added.
