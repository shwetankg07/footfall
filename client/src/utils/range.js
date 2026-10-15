export const RANGES = [
  { key: "24h", label: "Last 24 hours", hours: 24 },
  { key: "7d", label: "Last 7 days", hours: 24 * 7 },
  { key: "30d", label: "Last 30 days", hours: 24 * 30 },
  { key: "90d", label: "Last 90 days", hours: 24 * 90 },
];

export const rangeFor = (key) => RANGES.find((range) => range.key === key) ?? RANGES[1];

// Rounded to the minute so the URL (and the API cache key) doesn't change on every render.
export const rangeQuery = (key) => {
  const range = rangeFor(key);
  const to = new Date(Math.ceil(Date.now() / 60000) * 60000);
  const from = new Date(to.getTime() - range.hours * 3600 * 1000);
  return `from=${from.toISOString()}&to=${to.toISOString()}`;
};
