const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("en-IN");

// 1,284 / 12.9K: full digits under ten thousand, compact above.
export const formatCount = (n) => (n >= 10000 ? compact.format(n) : whole.format(n));

export const formatTick = (n) => (n >= 1000 ? compact.format(n) : String(n));

export const formatTime = (date, unit, timeZone, withDay = false) => {
  const options =
    unit === "hour"
      ? { hour: "numeric", ...(withDay && { weekday: "short" }), timeZone }
      : { day: "numeric", month: "short", timeZone };
  return new Intl.DateTimeFormat("en-IN", options).format(new Date(date));
};

export const formatDateTime = (date, timeZone, unit = "hour") =>
  new Intl.DateTimeFormat("en-IN", {
    weekday: "short", day: "numeric", month: "short", timeZone,
    ...(unit === "hour" && { hour: "numeric", minute: "2-digit" }),
  }).format(new Date(date));

export const timeAgo = (date) => {
  const seconds = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (seconds < 60) return "just now";
  if (seconds < 3600) return rtf.format(-Math.round(seconds / 60), "minute");
  if (seconds < 86400) return rtf.format(-Math.round(seconds / 3600), "hour");
  return rtf.format(-Math.round(seconds / 86400), "day");
};

// Change vs the previous period, as a whole percent. null when there's nothing to compare against.
export const percentChange = (now, before) => (before ? Math.round(((now - before) / before) * 100) : null);
