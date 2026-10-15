// Bucket starts in a site's timezone, so "Tuesday 9pm" means 9pm where the site owner lives.
// They have to land exactly where MongoDB's $dateTrunc (with the same timezone) puts them.

const offsetMinutes = (timeZone, date) => {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName").value; // "GMT+05:30" or "GMT"
  const match = name.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -minutes : minutes;
};

const localParts = (date, timeZone) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric" })
      .formatToParts(date)
      .map((part) => [part.type, Number(part.value)])
  );

// Wall-clock time in a zone -> UTC instant. The second pass fixes the offset when a DST change sits in between.
const zonedToUtc = (year, month, day, hour, timeZone) => {
  const wall = Date.UTC(year, month - 1, day, hour);
  const first = wall - offsetMinutes(timeZone, new Date(wall)) * 60000;
  return new Date(wall - offsetMinutes(timeZone, new Date(first)) * 60000);
};

const HOUR_MS = 60 * 60 * 1000;

export const truncate = (date, unit, timeZone) => {
  const p = localParts(date, timeZone);
  return zonedToUtc(p.year, p.month, p.day, unit === "hour" ? p.hour : 0, timeZone);
};

// Every bucket start from `from` up to (not including) `to`.
// Hours step by 60 minutes; days step to the next local midnight, so 23- and 25-hour DST days come out right.
export const bucketStarts = (from, to, unit, timeZone) => {
  const starts = [];
  let t = truncate(from, unit, timeZone);
  while (t < to) {
    starts.push(t);
    t = unit === "hour" ? new Date(t.getTime() + HOUR_MS) : truncate(new Date(t.getTime() + 27 * HOUR_MS), "day", timeZone);
  }
  return starts;
};
