from __future__ import annotations

from typing import Any, Protocol

import pandas as pd
from bson import ObjectId
from bson.errors import InvalidId
from pymongo import ASCENDING, MongoClient, UpdateOne
from pymongo.errors import DuplicateKeyError

from .models import Forecast
from .time import DEFAULT_TIMEZONE, floor_hour, now_utc, utc


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
        return list(self.db.sites.find({"_id": site} if site else {}, {"timezone": 1, "name": 1}))

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
