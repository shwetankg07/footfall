from __future__ import annotations

import argparse
import hashlib
import logging
import os
from typing import Any, Iterator

import numpy as np
import pandas as pd
from bson import ObjectId

from .data import MongoRepository, parse_site_id
from .synth import Traffic, generate
from .time import DEFAULT_TIMEZONE, floor_hour

LOG = logging.getLogger(__name__)
SLUGS = ("keyboard", "headphones", "desk-lamp", "notebook")


def visitor_hash(site: ObjectId, seed: int, person: int, at: pd.Timestamp, timezone: str) -> str:
    day = at.tz_convert(timezone).strftime("%Y-%m-%d")
    return hashlib.sha256(f"footfall-demo:{site}:{seed}:{person}:{day}".encode()).hexdigest()


def demo_events(site: ObjectId, traffic: Traffic, seed: int = 7, timezone: str = "Asia/Kolkata") -> Iterator[dict[str, Any]]:
    """Create ordered shop sessions while preserving each synthetic hourly pageview total."""
    rng = np.random.default_rng(seed)
    for hour, row in traffic.frame.iterrows():
        remaining = int(row["count"])
        while remaining:
            # Person identities recur within a local day; hashes rotate each local midnight.
            person = int(rng.integers(0, 240))
            start_second = int(rng.integers(0, 3300))
            timestamp = hour + pd.Timedelta(seconds=start_second)
            referrer = rng.choice([None, "www.google.com", "www.linkedin.com", "wa.me"], p=[0.36, 0.40, 0.12, 0.12])
            device = str(rng.choice(["desktop", "mobile", "tablet"], p=[0.35, 0.61, 0.04]))
            browser = str(rng.choice(["Chrome", "Safari", "Firefox", "Edge"], p=[0.70, 0.19, 0.06, 0.05]))
            operating_system = "Android" if device == "mobile" and browser != "Safari" else "iOS" if device != "desktop" else str(rng.choice(["Windows", "macOS", "Linux"], p=[0.65, 0.27, 0.08]))
            country = str(rng.choice(["IN", "US", "GB", "SG", "DE"], p=[0.82, 0.07, 0.04, 0.04, 0.03]))
            paths = ["/"]
            if rng.random() < 0.78:
                paths.append("/products")
                if rng.random() < 0.78:
                    paths.append(f"/product/{rng.choice(SLUGS)}")
                    if rng.random() < 0.36:
                        paths.append("/cart")
                        if rng.random() < 0.58:
                            paths.append("/checkout")
            paths = paths[:remaining]
            for step, path in enumerate(paths):
                at = timestamp + pd.Timedelta(seconds=step * int(rng.integers(12, 55)))
                visitor = visitor_hash(site, seed, person, at, timezone)
                document = {
                    "site": site, "ts": at.to_pydatetime(), "name": "pageview", "path": path,
                    "referrer": referrer, "utmSource": "linkedin" if referrer == "www.linkedin.com" else "whatsapp" if referrer == "wa.me" else None,
                    "device": device, "browser": browser, "os": operating_system, "country": country, "visitor": visitor,
                }
                yield document
                if path == "/checkout" and rng.random() < 0.65:
                    paid_at = at + pd.Timedelta(seconds=20)
                    yield document | {"ts": paid_at.to_pydatetime(), "name": "paid", "visitor": visitor_hash(site, seed, person, paid_at, timezone)}
            remaining -= len(paths)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Seed individual shop events for an existing demo site")
    parser.add_argument("--site", type=parse_site_id, required=True)
    parser.add_argument("--days", type=int, default=28)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--replace", action="store_true", help="delete this site's existing events before inserting")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    if args.days < 7:
        parser.error("--days must be at least 7")
    uri = os.environ.get("MONGO_URI")
    if not uri:
        LOG.error("MONGO_URI is not set; no demo events written")
        return 2
    repository = None
    try:
        repository = MongoRepository(uri, os.environ.get("MONGO_DB") or "footfall")
        site = repository.db.sites.find_one({"_id": args.site})
        if site is None:
            LOG.error("site %s does not exist; create it through the app first", args.site)
            return 1
        # Generate everything before deleting anything; invalid site timezones cannot lose data.
        timezone = site.get("timezone") or DEFAULT_TIMEZONE
        end = floor_hour(pd.Timestamp.now(tz="UTC"), timezone)
        traffic = generate(days=args.days, level="medium", seed=args.seed, start=end - pd.Timedelta(days=args.days), timezone=timezone, anomaly_count=3, anomaly_start_day=max(1, args.days // 3), spikes_only=True)
        events = list(demo_events(args.site, traffic, args.seed, timezone))
        if repository.db.events.find_one({"site": args.site}, {"_id": 1}) and not args.replace:
            LOG.error("site already has events; use --replace to explicitly replace them")
            return 1
        if args.replace:
            deleted = repository.db.events.delete_many({"site": args.site}).deleted_count
            LOG.info("removed %s previous events for site %s", deleted, args.site)
        for offset in range(0, len(events), 1000):
            repository.db.events.insert_many(events[offset : offset + 1000], ordered=False)
        LOG.info("inserted %s events (%s pageviews) for site %s", len(events), int(traffic.frame['count'].sum()), args.site)
        for window in traffic.windows:
            LOG.info("injected %s from %s to %s (%.1fx)", window.kind, window.start, window.end, window.factor)
        return 0
    except Exception:
        LOG.exception("demo seeding failed")
        return 1
    finally:
        if repository is not None:
            repository.close()


if __name__ == "__main__":
    raise SystemExit(main())
