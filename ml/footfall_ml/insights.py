from __future__ import annotations

import argparse
import logging
import os
from typing import Any

import pandas as pd
from bson import ObjectId

from .data import MongoRepository, Repository, parse_site_id
from .funnels import conversion_drivers, funnel_population
from .opportunities import leaky_page, next_week, opportunity_population, peak_hours, rank_opportunities, strong_source, weak_device
from .score import eligible, production_model
from .time import DEFAULT_TIMEZONE, floor_hour, utc
from .visitors import summarize_visitors

LOG = logging.getLogger(__name__)


def compute_site(repository: Repository, site: dict[str, Any], now: pd.Timestamp, dry_run: bool = False) -> int:
    now = utc(now)
    timezone = site.get("timezone") or DEFAULT_TIMEZONE
    cutoff = floor_hour(now, timezone)
    start = cutoff - pd.Timedelta(days=30)
    # Production hashes rotate at UTC midnight; demo hashes use local midnight.
    # Load both possible full first days for metadata, then clip funnel events.
    load_start = min(start.floor("d"), start.tz_convert(timezone).normalize().tz_convert("UTC"))
    events = repository.events(site["_id"], load_start, cutoff)
    visitors = summarize_visitors(events, start, cutoff)
    documents = []
    for funnel in repository.funnels(site["_id"]):
        population = funnel_population(visitors, funnel["steps"])
        entered, converted = len(population), int(population.converted.sum())
        documents.append({
            "site": site["_id"], "kind": "funnel_drivers", "key": str(funnel["_id"]), "funnel": funnel["_id"],
            "from": start.to_pydatetime(), "to": cutoff.to_pydatetime(), "computedAt": now.to_pydatetime(),
            "entered": entered, "converted": converted, "rate": converted / entered if entered else 0.0,
            "drivers": conversion_drivers(population),
        })
    opportunity_start = cutoff - pd.Timedelta(days=28)
    population = opportunity_population(summarize_visitors(events, opportunity_start, cutoff))
    items = leaky_page(population) + strong_source(population) + weak_device(population)
    first = repository.first_event(site["_id"])
    if first is not None:
        first = utc(first)
        history = repository.hourly(site["_id"], max(floor_hour(first, timezone), cutoff - pd.Timedelta(days=56)), cutoff, timezone=timezone)
        peak = peak_hours(history, timezone)
        if peak:
            items.append(peak)
        if eligible(history, first, cutoff) is None:
            items.append(next_week(history, timezone, production_model()))
    documents.append({
        "site": site["_id"], "kind": "opportunities", "key": "site", "from": opportunity_start.to_pydatetime(),
        "to": cutoff.to_pydatetime(), "computedAt": now.to_pydatetime(), "items": rank_opportunities(items),
    })
    for document in documents:
        if not dry_run:
            repository.upsert_insight(document)
    LOG.info("site %s: %s %s insights", site["_id"], "would write" if dry_run else "wrote", len(documents))
    return 0 if dry_run else len(documents)


def run(repository: Repository, now: pd.Timestamp, *, site_id: ObjectId | None = None, dry_run: bool = False) -> int:
    now = utc(now)
    written = 0
    for site in repository.intelligence_sites(now, site_id):
        try:
            written += compute_site(repository, site, now, dry_run)
        except Exception:
            LOG.exception("site %s insights failed; continuing", site["_id"])
    return written


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compute Pro funnel drivers and opportunities")
    parser.add_argument("--site", type=parse_site_id)
    parser.add_argument("--dry-run", action="store_true", help="read and compute without indexes or insight writes")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    uri = os.environ.get("MONGO_URI")
    if not uri:
        LOG.error("MONGO_URI is not set. Set it to your MongoDB connection string; MONGO_DB defaults to footfall. No work was performed.")
        return 2
    repository = None
    try:
        repository = MongoRepository(uri, os.environ.get("MONGO_DB") or "footfall")
        if not args.dry_run:
            repository.ensure_insight_index()
        run(repository, pd.Timestamp.now(tz="UTC"), site_id=args.site, dry_run=args.dry_run)
        return 0
    except Exception:
        LOG.exception("MongoDB setup or site loading failed")
        return 1
    finally:
        if repository is not None:
            repository.close()


if __name__ == "__main__":
    raise SystemExit(main())
