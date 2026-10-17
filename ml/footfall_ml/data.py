from __future__ import annotations

from collections import defaultdict
import logging
from typing import Any, Protocol

import pandas as pd
from bson import ObjectId
from bson.errors import InvalidId
from pymongo import ASCENDING, MongoClient, UpdateOne
from pymongo.errors import DuplicateKeyError

from .models import Forecast
from .time import DEFAULT_TIMEZONE, floor_hour, now_utc, utc
from .visitors import DIMENSIONS

LOG = logging.getLogger(__name__)


def parse_site_id(value: str) -> ObjectId:
    try:
        return ObjectId(value)
    except InvalidId as error:
        raise ValueError("site must be a 24-character MongoDB ObjectId") from error


class Repository(Protocol):
    def sites(self, site: ObjectId | None = None) -> list[dict[str, Any]]: ...
    def first_event(self, site: ObjectId) -> pd.Timestamp | None: ...
    def hourly(self, site: ObjectId, start: pd.Timestamp, until: pd.Timestamp, timezone: str = DEFAULT_TIMEZONE) -> pd.Series: ...
    def forecasts(self, site: ObjectId, hours: pd.DatetimeIndex) -> dict[pd.Timestamp, dict[str, Any]]: ...
    def save_forecasts(self, site: ObjectId, forecast: Forecast, issued_at: pd.Timestamp, historical: bool = False, timezone: str = DEFAULT_TIMEZONE) -> int: ...
    def insert_alert(self, alert: dict[str, Any]) -> bool: ...
    def intelligence_sites(self, now: pd.Timestamp, site: ObjectId | None = None) -> list[dict[str, Any]]: ...
    def alert_segments(self, site: ObjectId, hour: pd.Timestamp, first: pd.Timestamp, timezone: str) -> tuple[dict, list[dict]]: ...
    def events(self, site: ObjectId, start: pd.Timestamp, until: pd.Timestamp) -> list[dict[str, Any]]: ...
    def funnels(self, site: ObjectId) -> list[dict[str, Any]]: ...
    def upsert_insight(self, document: dict[str, Any]) -> None: ...


class MongoRepository:
    def __init__(self, uri: str, db_name: str = "footfall") -> None:
        self.client: MongoClient = MongoClient(uri, tz_aware=True, serverSelectionTimeoutMS=5000)
        # The database in the URI is intentionally ignored.
        self.db = self.client[db_name]

    def close(self) -> None:
        self.client.close()

    def ensure_indexes(self) -> None:
        keys = [("site", ASCENDING), ("hour", ASCENDING), ("metric", ASCENDING)]
        for collection in (self.db.forecasts, self.db.alerts):
            existing = collection.index_information().values()
            if not any(list(index["key"]) == keys and index.get("unique") for index in existing):
                collection.create_index(keys, unique=True)

    def sites(self, site: ObjectId | None = None) -> list[dict[str, Any]]:
        return list(self.db.sites.find({"_id": site} if site else {}, {"timezone": 1, "name": 1, "owner": 1}))

    def intelligence_sites(self, now: pd.Timestamp, site: ObjectId | None = None) -> list[dict[str, Any]]:
        sites = self.sites(site)
        owners = list({row["owner"] for row in sites if row.get("owner") is not None})
        query = {"_id": {"$in": owners}, "$or": [{"proUntil": {"$gt": utc(now).to_pydatetime()}}, {"trialEndsAt": {"$gt": utc(now).to_pydatetime()}}]}
        entitled = {row["_id"] for row in self.db.users.find(query, {"_id": 1})} if owners else set()
        result = []
        for row in sites:
            if row.get("owner") in entitled:
                result.append(row)
            else:
                LOG.info("site %s skipped: free plan", row["_id"])
        return result

    def ensure_insight_index(self) -> None:
        keys = [("site", ASCENDING), ("kind", ASCENDING), ("key", ASCENDING)]
        existing = self.db.insights.index_information().values()
        if not any(list(index["key"]) == keys and index.get("unique") for index in existing):
            self.db.insights.create_index(keys, unique=True)

    def events(self, site: ObjectId, start: pd.Timestamp, until: pd.Timestamp) -> list[dict[str, Any]]:
        fields = {key: 1 for key in ("visitor", "ts", "name", *DIMENSIONS)}
        return list(self.db.events.find({"site": site, "ts": {"$gte": utc(start).to_pydatetime(), "$lt": utc(until).to_pydatetime()}}, fields).sort([("ts", ASCENDING), ("_id", ASCENDING)]))

    def funnels(self, site: ObjectId) -> list[dict[str, Any]]:
        return list(self.db.funnels.find({"site": site}))

    def upsert_insight(self, document: dict[str, Any]) -> None:
        key = {field: document[field] for field in ("site", "kind", "key")}
        self.db.insights.update_one(key, {"$set": document}, upsert=True)

    def alert_segments(self, site: ObjectId, hour: pd.Timestamp, first: pd.Timestamp, timezone: str) -> tuple[dict, list[dict]]:
        hour, first = utc(hour), utc(first)
        local = hour.tz_convert(timezone)
        references = []
        for week in range(1, 5):
            wall = local.tz_localize(None) - pd.DateOffset(weeks=week)
            prior = wall.tz_localize(timezone, ambiguous=bool(local.dst()), nonexistent="NaT")
            if pd.isna(prior):
                if wall >= first.tz_convert(timezone).tz_localize(None):
                    references.append(None)
            elif prior.tz_convert("UTC") >= first:
                prior = prior.tz_convert("UTC")
                references.append(prior)
        if len(references) < 2:
            return {}, []
        hours = [hour, *(prior for prior in references if prior is not None)]
        pipeline = [
            {"$match": {"site": site, "name": "pageview", "$or": [{"ts": {"$gte": h.to_pydatetime(), "$lt": (h + pd.Timedelta(hours=1)).to_pydatetime()}} for h in hours]}},
            {"$group": {"_id": {"hour": {"$dateTrunc": {"date": "$ts", "unit": "hour", "timezone": timezone}}, **{key: f"${key}" for key in DIMENSIONS}}, "count": {"$sum": 1}}},
        ]
        counts = {h: {key: defaultdict(int) for key in DIMENSIONS} for h in hours}
        for row in self.db.events.aggregate(pipeline):
            bucket = counts[utc(row["_id"]["hour"])]
            for key in DIMENSIONS:
                bucket[key][row["_id"].get(key)] += int(row["count"])
        return counts[hour], [counts[prior] if prior is not None else {} for prior in references]

    def first_event(self, site: ObjectId) -> pd.Timestamp | None:
        document = self.db.events.find_one({"site": site}, {"ts": 1}, sort=[("ts", ASCENDING)])
        return utc(document["ts"]) if document else None

    def hourly(self, site: ObjectId, start: pd.Timestamp, until: pd.Timestamp, timezone: str = DEFAULT_TIMEZONE) -> pd.Series:
        start, until = floor_hour(start, timezone), floor_hour(until, timezone)
        index = pd.date_range(start.tz_convert(timezone), until.tz_convert(timezone), freq="h", inclusive="left").tz_convert("UTC")
        pipeline = [
            {"$match": {"site": site, "name": "pageview", "ts": {"$gte": start.to_pydatetime(), "$lt": until.to_pydatetime()}}},
            {"$group": {"_id": {"$dateTrunc": {"date": "$ts", "unit": "hour", "timezone": timezone}}, "count": {"$sum": 1}}},
            {"$sort": {"_id": 1}},
        ]
        rows = list(self.db.events.aggregate(pipeline))
        result = pd.Series(0, index=index, name="count", dtype="int64")
        for row in rows:
            result.loc[utc(row["_id"])] = int(row["count"])
        return result

    def forecasts(self, site: ObjectId, hours: pd.DatetimeIndex) -> dict[pd.Timestamp, dict[str, Any]]:
        rows = self.db.forecasts.find({"site": site, "metric": "pageviews", "hour": {"$in": [h.to_pydatetime() for h in hours]}})
        return {utc(row["hour"]): row for row in rows}

    def save_forecasts(self, site: ObjectId, forecast: Forecast, issued_at: pd.Timestamp, historical: bool = False, timezone: str = DEFAULT_TIMEZONE) -> int:
        issued_at = utc(issued_at)
        issued_cutoff = floor_hour(issued_at, timezone)
        write_cutoff = issued_cutoff
        if not historical:
            write_cutoff = max(write_cutoff, floor_hour(now_utc(), timezone))
        requests = []
        for hour, row in forecast.frame.iterrows():
            if hour <= issued_cutoff:
                raise ValueError("cannot write a forecast for an hour already started at issue time")
            if hour <= write_cutoff:
                continue  # A long-running job may have crossed the next hour boundary.
            document = {
                "site": site, "hour": hour.to_pydatetime(), "metric": "pageviews",
                "expected": float(row.expected), "lo": float(row.lo), "hi": float(row.hi),
                "model": forecast.model, "updatedAt": issued_at.to_pydatetime(),
            }
            key = {field: document[field] for field in ("site", "hour", "metric")}
            requests.append(UpdateOne(key, {"$setOnInsert" if historical else "$set": document}, upsert=True))
        if requests:
            self.db.forecasts.bulk_write(requests, ordered=False)
        return len(requests)

    def insert_alert(self, alert: dict[str, Any]) -> bool:
        try:
            self.db.alerts.insert_one(alert)
            return True
        except DuplicateKeyError:
            return False


def alert_document(site: ObjectId, hour: pd.Timestamp, actual: int, row: dict[str, Any], kind: str, score: float, now: pd.Timestamp) -> dict[str, Any]:
    return {
        "site": site, "hour": hour.to_pydatetime(), "metric": "pageviews", "kind": kind,
        "actual": int(actual), "expected": float(row["expected"]), "lo": float(row["lo"]),
        "hi": float(row["hi"]), "score": float(score), "model": str(row["model"]),
        "createdAt": now.to_pydatetime(), "notifiedAt": None, "readBy": [],
    }
