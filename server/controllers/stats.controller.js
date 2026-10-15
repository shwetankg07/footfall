import Forecast from "../models/forecast.model.js";
import { parseRange } from "../utils/range.js";
import { siteStats } from "../utils/stats.js";

// ponytail: 10s in-process cache so a dashboard refresh storm costs one aggregation; drop or move to Redis with more instances.
const CACHE_MS = 10 * 1000;
const cache = new Map();

export const statsFor = async (site, query) => {
  const range = parseRange(query);
  if (range.error) return range;

  const key = `${site._id}|${range.from.toISOString()}|${range.to.toISOString()}|${range.unit}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.stats;

  const stats = await siteStats(site, range);
  cache.set(key, { stats, at: Date.now() });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return stats;
};

export const getStats = async (req, res) => {
  const stats = await statsFor(req.site, req.query);
  if (stats.error) return res.status(400).json({ message: stats.error });
  res.json(stats);
};

// The ML job's predicted normal range for each hour, drawn as a band behind the hourly chart.
export const getForecast = async (req, res) => {
  const range = parseRange(req.query);
  if (range.error) return res.status(400).json({ message: range.error });

  const points = await Forecast.find({
    site: req.site._id,
    metric: "pageviews",
    hour: { $gte: range.from, $lt: new Date(range.to.getTime() + 24 * 60 * 60 * 1000) },
  })
    .sort({ hour: 1 })
    .select("-_id hour expected lo hi model")
    .lean();

  res.json({ points });
};
