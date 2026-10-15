// node utils/timeBuckets.check.js — bucket starts must match MongoDB's $dateTrunc, DST days included.
import assert from "node:assert/strict";
import { truncate, bucketStarts } from "./timeBuckets.js";

const iso = (dates) => dates.map((d) => d.toISOString());

// India: half-hour offset, no DST. Local hours start at :30 UTC.
assert.equal(truncate(new Date("2026-10-15T13:47:00Z"), "hour", "Asia/Kolkata").toISOString(), "2026-10-15T13:30:00.000Z");
assert.equal(truncate(new Date("2026-10-15T13:47:00Z"), "day", "Asia/Kolkata").toISOString(), "2026-10-14T18:30:00.000Z");
assert.equal(bucketStarts(new Date("2026-10-15T00:00:00Z"), new Date("2026-10-15T03:00:00Z"), "hour", "Asia/Kolkata").length, 4);

// New York, spring forward on 8 Mar 2026: midnight moves from 05:00Z to 04:00Z.
assert.equal(truncate(new Date("2026-03-08T16:00:00Z"), "day", "America/New_York").toISOString(), "2026-03-08T05:00:00.000Z");
assert.deepEqual(iso(bucketStarts(new Date("2026-03-07T12:00:00Z"), new Date("2026-03-10T12:00:00Z"), "day", "America/New_York")), [
  "2026-03-07T05:00:00.000Z",
  "2026-03-08T05:00:00.000Z",
  "2026-03-09T04:00:00.000Z",
  "2026-03-10T04:00:00.000Z",
]);

// Fall back on 1 Nov 2026: a 25-hour day, then midnight is 05:00Z again.
assert.deepEqual(iso(bucketStarts(new Date("2026-10-31T12:00:00Z"), new Date("2026-11-02T12:00:00Z"), "day", "America/New_York")), [
  "2026-10-31T04:00:00.000Z",
  "2026-11-01T04:00:00.000Z",
  "2026-11-02T05:00:00.000Z",
]);

assert.equal(truncate(new Date("2026-10-15T13:47:00Z"), "hour", "UTC").toISOString(), "2026-10-15T13:00:00.000Z");
console.log("time bucket checks passed");
