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
from .synth import AnomalyWindow, Traffic, generate
from .time import DEFAULT_TIMEZONE, floor_hour

LOG = logging.getLogger(__name__)
SLUGS = ("keyboard", "headphones", "desk-lamp", "notebook")


def visitor_hash(site: ObjectId, seed: int, person: int, at: pd.Timestamp, timezone: str) -> str:
    day = at.tz_convert(timezone).strftime("%Y-%m-%d")
    return hashlib.sha256(f"footfall-demo:{site}:{seed}:{person}:{day}".encode()).hexdigest()


def demo_traffic(days: int, start: pd.Timestamp, seed: int = 7, timezone: str = DEFAULT_TIMEZONE) -> Traffic:
    traffic = generate(days=days, level="medium", seed=seed, start=start, timezone=timezone,
                       anomaly_count=2, anomaly_start_day=max(2, days // 2 + 1), spikes_only=True)
    frame = traffic.frame.copy()
    # Choose an afternoon with enough expected traffic and no nearby campaign spike.
    candidates = [hour for hour in frame.index[max(1, days - 6) * 24 : -4]
                  if hour.tz_convert(timezone).hour == 13
                  and not any(window.start - pd.Timedelta(hours=12) <= hour < window.end + pd.Timedelta(hours=12) for window in traffic.windows)]
    if candidates:
        hour = candidates[0]
        outage = AnomalyWindow(hour, hour + pd.Timedelta(hours=3), "drop", 0.0)
        selected = (frame.index >= outage.start) & (frame.index < outage.end)
        frame.loc[selected, ["count", "mean"]] = 0
        frame.loc[selected, "label"] = "drop"
        return Traffic(frame, tuple(sorted((*traffic.windows, outage), key=lambda window: window.start)))
    raise ValueError("not enough room for demo campaigns and a separate three-hour outage")


def demo_events(site: ObjectId, traffic: Traffic, seed: int = 7, timezone: str = "Asia/Kolkata") -> Iterator[dict[str, Any]]:
    """Create ordered shop sessions while preserving each synthetic hourly pageview total."""
    rng = np.random.default_rng(seed)
    person = 0
    sources = ("news.ycombinator.com", "linkedin.com")
    spike_sources = {window.start: sources[n % len(sources)] for n, window in enumerate(w for w in traffic.windows if w.kind == "spike")}
    for hour, row in traffic.frame.iterrows():
        remaining = int(row["count"])
        while remaining:
            person += 1  # One fake person-day per visit, avoiding cross-session funnel stitching.
            start_second = int(rng.integers(0, 3300))
            timestamp = hour + pd.Timedelta(seconds=start_second)
            referrer = rng.choice([None, "www.google.com", "linkedin.com", "wa.me", "news.ycombinator.com"], p=[0.27, 0.30, 0.23, 0.15, 0.05])
            for window in traffic.windows:
                if window.kind == "spike" and window.start <= hour < window.end and rng.random() < 1 - 1 / window.factor:
                    referrer = spike_sources[window.start]
            device = str(rng.choice(["desktop", "mobile", "tablet"], p=[0.75, 0.22, 0.03] if referrer == "news.ycombinator.com" else [0.46, 0.46, 0.08]))
            browser = str(rng.choice(["Chrome", "Safari", "Firefox", "Edge"], p=[0.38, 0.30, 0.20, 0.12]))
            operating_system = "Android" if device == "mobile" and browser != "Safari" else "iOS" if device != "desktop" else str(rng.choice(["Windows", "macOS", "Linux"], p=[0.65, 0.27, 0.08]))
            country = str(rng.choice(["IN", "US", "GB", "SG", "DE"], p=[0.44, 0.22, 0.14, 0.12, 0.08]))
            entry = str(rng.choice(["/", "/blog/launch", "/products"], p=[0.82, 0.12, 0.06]))
            paths = [entry]
            bounce = 0.88 if entry == "/blog/launch" else {"mobile": 0.58, "desktop": 0.12, "tablet": 0.35}[device]
            if rng.random() >= bounce:
                if entry != "/":
                    paths.append("/")
                paths.append("/products")
                if rng.random() < 0.86:
                    paths.append(f"/product/{rng.choice(SLUGS)}")
                    if rng.random() < 0.62:
                        paths.append("/cart")
                        if rng.random() < 0.88:
                            paths.append("/checkout")
            paths = paths[:remaining]
            at = timestamp
            for step, path in enumerate(paths):
                if step:
                    at += pd.Timedelta(seconds=int(rng.integers(12, 45)))
                visitor = visitor_hash(site, seed, person, at, timezone)
                document = {
                    "site": site, "ts": at.to_pydatetime(), "name": "pageview", "path": path,
                    "referrer": referrer, "utmSource": "linkedin" if referrer == "linkedin.com" else "whatsapp" if referrer == "wa.me" else None,
                    "device": device, "browser": browser, "os": operating_system, "country": country, "visitor": visitor,
                }
                yield document
                if path == "/checkout" and rng.random() < (0.90 if referrer == "linkedin.com" else 0.45):
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
        traffic = demo_traffic(args.days, end - pd.Timedelta(days=args.days), args.seed, timezone)
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
