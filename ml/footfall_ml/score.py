from __future__ import annotations

import argparse
import json
import logging
import os
from pathlib import Path
from typing import Any, Callable
from urllib.error import URLError
from urllib.request import Request, urlopen

import pandas as pd
from bson import ObjectId

from .data import MongoRepository, Repository, alert_document, parse_site_id
from .detect import detect
from .models import Forecast, MODEL_TYPES, make_model
from .time import DEFAULT_TIMEZONE, floor_hour, utc

LOG = logging.getLogger(__name__)
SELECTION_FILE = Path(__file__).with_name("selection.json")


def production_model() -> str:
    selection = json.loads(SELECTION_FILE.read_text())
    name = selection["model"]
    if name not in MODEL_TYPES or name == "naive_threshold":
        raise ValueError(f"invalid production model in {SELECTION_FILE}")
    return name


def eligible(history: pd.Series, first: pd.Timestamp, at: pd.Timestamp) -> str | None:
    if at - first < pd.Timedelta(days=7) or len(history) < 168:
        return "under 7 days of history since first event"
    recent = history.iloc[-168:]
    if recent.sum() < 84 or (recent > 0).sum() < 12:
        return "too little volume (need 84 pageviews and 12 active hours in the past week)"
    return None


def score_site(
    repository: Repository,
    site: dict[str, Any],
    now: pd.Timestamp,
    *,
    dry_run: bool = False,
    historical: bool = False,
    model_name: str | None = None,
) -> tuple[int, int]:
    now = utc(now)
    timezone = site.get("timezone") or DEFAULT_TIMEZONE
    cutoff = floor_hour(now, timezone)
    site_id = site["_id"]
    first = repository.first_event(site_id)
    if first is None:
        LOG.info("site %s skipped: no events", site_id)
        return 0, 0
    first = utc(first)
    start = max(floor_hour(first, timezone), cutoff - pd.Timedelta(days=56))
    history = repository.hourly(site_id, start, cutoff, timezone=timezone)
    reason = eligible(history, first, cutoff)
    if reason:
        LOG.info("site %s skipped: %s", site_id, reason)
        return 0, 0
    name = model_name or production_model()
    hours = pd.date_range(cutoff - pd.Timedelta(hours=3), periods=3, freq="h")
    stored = repository.forecasts(site_id, hours)
    alerts = 0
    for hour in hours:
        row = stored.get(hour)
        dispersion = None
        rule = "count"
        if row is None:
            before = history.loc[history.index < hour]
            if eligible(before, first, hour):
                continue
            fitted = make_model(name).fit(before, timezone)
            forecast = fitted.predict(pd.DatetimeIndex([hour]))
            row = forecast.frame.iloc[0].to_dict() | {"model": forecast.model}
            dispersion, rule = forecast.dispersion, forecast.rule
        decision = detect(int(history.loc[hour]), float(row["expected"]), float(row["lo"]), float(row["hi"]), dispersion, rule=rule)
        if decision:
            document = alert_document(site_id, hour, int(history.loc[hour]), row, decision.kind, decision.score, now)
            if dry_run:
                LOG.info("dry-run alert: site=%s hour=%s kind=%s actual=%s expected=%.2f", site_id, hour, decision.kind, history.loc[hour], row["expected"])
            elif repository.insert_alert(document):
                alerts += 1
    fitted = make_model(name).fit(history, timezone)
    future = pd.date_range(cutoff + pd.Timedelta(hours=1), periods=24, freq="h")
    forecast = fitted.predict(future)
    written = 0 if dry_run else repository.save_forecasts(site_id, forecast, now, historical=historical, timezone=timezone)
    LOG.info("site %s: %s%s forecasts, %s new alerts (%s)", site_id, "would write " if dry_run else "wrote ", len(future) if dry_run else written, alerts, name)
    return written, alerts


def run(
    repository: Repository,
    now: pd.Timestamp,
    *,
    site_id: ObjectId | None = None,
    dry_run: bool = False,
    backfill_days: int = 0,
    model_name: str | None = None,
) -> tuple[int, int]:
    if backfill_days < 0:
        raise ValueError("backfill days cannot be negative")
    now = utc(now)
    sites = repository.sites(site_id)
    if not sites:
        LOG.warning("no matching sites found")
    forecasts, alerts = 0, 0
    for site in sites:
        try:
            cutoff = floor_hour(now, site.get("timezone") or DEFAULT_TIMEZONE)
            moments = pd.date_range(cutoff - pd.Timedelta(days=backfill_days), cutoff, freq="h", inclusive="left") if backfill_days else []
        except Exception:
            LOG.exception("site %s failed to determine local-hour boundaries; continuing", site["_id"])
            continue
        for moment in [*moments, now]:
            try:
                written, inserted = score_site(repository, site, moment, dry_run=dry_run, historical=moment != now, model_name=model_name)
                forecasts += written
                alerts += inserted
            except Exception:
                LOG.exception("site %s failed at %s; continuing", site["_id"], moment)
    return forecasts, alerts


def flush_alerts(api_url: str | None, secret: str | None, opener: Callable = urlopen) -> None:
    if not api_url:
        return
    if not secret:
        LOG.warning("API_URL set but INTERNAL_SECRET missing; alert flush skipped")
        return
    request = Request(api_url.rstrip("/") + "/internal/alerts/flush", data=b"{}", headers={"x-internal-secret": secret, "Content-Type": "application/json"}, method="POST")
    try:
        with opener(request, timeout=10) as response:
            response.read()
    except (URLError, OSError, ValueError):
        LOG.warning("alert flush failed; unnotified alerts will be retried next run", exc_info=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Forecast the next 24 hours and score the last three completed hours")
    parser.add_argument("--site", type=parse_site_id)
    parser.add_argument("--dry-run", action="store_true", help="read and compute without writes, indexes, or notification flush")
    parser.add_argument("--backfill-days", type=int, default=0, help="explicit historical replay; existing past forecasts are preserved")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    if args.backfill_days < 0:
        parser.error("--backfill-days must be nonnegative")
    uri = os.environ.get("MONGO_URI")
    if not uri:
        LOG.error("MONGO_URI is not set. Set it to your MongoDB connection string; MONGO_DB defaults to footfall. No work was performed.")
        return 2
    repository = None
    try:
        repository = MongoRepository(uri, os.environ.get("MONGO_DB") or "footfall")
        if not args.dry_run:
            repository.ensure_indexes()
        run(repository, pd.Timestamp.now(tz="UTC"), site_id=args.site, dry_run=args.dry_run, backfill_days=args.backfill_days)
        if not args.dry_run:
            flush_alerts(os.environ.get("API_URL"), os.environ.get("INTERNAL_SECRET"))
        return 0
    except Exception:
        LOG.exception("MongoDB setup or site loading failed")
        return 1
    finally:
        if repository is not None:
            repository.close()


if __name__ == "__main__":
    raise SystemExit(main())
