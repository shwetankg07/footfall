import Event from "../models/event.model.js";
import { bucketStarts } from "./timeBuckets.js";

const TOP = 10;

// A visitor counts toward the source they arrived from. Only the first page view of a visit carries
// the outside referrer, so filing each page view on its own put the rest of every visit under "direct".
const sources = [
  { $match: { name: "pageview" } },
  { $sort: { ts: 1 } },
  { $group: { _id: "$visitor", entry: { $first: "$referrer" }, seen: { $max: "$referrer" }, pageviews: { $sum: 1 } } },
  { $group: { _id: { $ifNull: ["$entry", "$seen"] }, visitors: { $sum: 1 }, pageviews: { $sum: "$pageviews" } } },
  { $project: { _id: 0, referrer: { $ifNull: ["$_id", null] }, visitors: 1, pageviews: 1 } },
  { $sort: { visitors: -1, pageviews: -1 } },
  { $limit: TOP },
];

// Visitors in a group = distinct visitor hashes in it.
const breakdown = (field, label = field) => [
  { $match: { name: "pageview" } },
  { $group: { _id: `$${field}`, visitors: { $addToSet: "$visitor" }, pageviews: { $sum: 1 } } },
  { $project: { _id: 0, [label]: { $ifNull: ["$_id", null] }, visitors: { $size: "$visitors" }, pageviews: 1 } },
  { $sort: { visitors: -1, pageviews: -1 } },
  { $limit: TOP },
];

// Per visitor first, so bounce rate (one page view, then gone) falls out of the same pass.
const summaryStages = [
  { $group: { _id: "$visitor", pageviews: { $sum: { $cond: [{ $eq: ["$name", "pageview"] }, 1, 0] } } } },
  {
    $group: {
      _id: null,
      visitors: { $sum: 1 },
      pageviews: { $sum: "$pageviews" },
      bounces: { $sum: { $cond: [{ $eq: ["$pageviews", 1] }, 1, 0] } },
    },
  },
];

const shapeSummary = (row) => {
  const visitors = row?.visitors ?? 0;
  const pageviews = row?.pageviews ?? 0;
  return {
    visitors,
    pageviews,
    viewsPerVisitor: visitors ? +(pageviews / visitors).toFixed(2) : 0,
    bounceRate: visitors ? Math.round(((row?.bounces ?? 0) / visitors) * 100) : 0,
  };
};

export const siteStats = async (site, { from, to, unit }) => {
  const [result] = await Event.aggregate([
    { $match: { site: site._id, ts: { $gte: from, $lt: to } } },
    {
      $facet: {
        summary: summaryStages,
        series: [
          { $match: { name: "pageview" } },
          {
            $group: {
              _id: { $dateTrunc: { date: "$ts", unit, timezone: site.timezone } },
              pageviews: { $sum: 1 },
              visitors: { $addToSet: "$visitor" },
            },
          },
          { $project: { pageviews: 1, visitors: { $size: "$visitors" } } },
        ],
        pages: breakdown("path", "path"),
        referrers: sources,
        devices: breakdown("device", "device"),
        browsers: breakdown("browser", "browser"),
        countries: breakdown("country", "country"),
        events: [
          { $match: { name: { $ne: "pageview" } } },
          { $group: { _id: "$name", count: { $sum: 1 }, visitors: { $addToSet: "$visitor" } } },
          { $project: { _id: 0, name: "$_id", count: 1, visitors: { $size: "$visitors" } } },
          { $sort: { count: -1 } },
          { $limit: TOP },
        ],
      },
    },
  ]);

  // Same-length window right before this one, for the "+12% vs previous" badges.
  const previousFrom = new Date(from.getTime() - (to - from));
  const [previous] = await Event.aggregate([
    { $match: { site: site._id, ts: { $gte: previousFrom, $lt: from } } },
    ...summaryStages,
  ]);

  // Charts need a point for every bucket, including the empty ones.
  const byBucket = new Map(result.series.map((row) => [row._id.getTime(), row]));
  const series = bucketStarts(from, to, unit, site.timezone).map((start) => ({
    t: start,
    pageviews: byBucket.get(start.getTime())?.pageviews ?? 0,
    visitors: byBucket.get(start.getTime())?.visitors ?? 0,
  }));

  return {
    range: { from, to, unit, timezone: site.timezone },
    summary: shapeSummary(result.summary[0]),
    previous: shapeSummary(previous),
    series,
    pages: result.pages,
    referrers: result.referrers,
    devices: result.devices,
    browsers: result.browsers,
    countries: result.countries,
    events: result.events,
  };
};
