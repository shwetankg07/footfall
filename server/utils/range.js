const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAYS = 366;

// ?from=ISO&to=ISO, defaulting to the last 7 days. Returns { error } for bad input.
export const parseRange = (query) => {
  const to = query.to ? new Date(query.to) : new Date(Math.ceil(Date.now() / 60000) * 60000);
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - 7 * DAY_MS);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { error: "from and to must be dates" };
  }
  if (from >= to) {
    return { error: "from must be before to" };
  }
  if (to - from > MAX_DAYS * DAY_MS) {
    return { error: `Pick a range of ${MAX_DAYS} days or less` };
  }
  // Hourly buckets by default up to 2 days; callers can ask for hourly up to 14 (the forecast view does).
  const hourly = to - from <= 2 * DAY_MS || (query.unit === "hour" && to - from <= 14 * DAY_MS);
  return { from, to, unit: hourly ? "hour" : "day" };
};
