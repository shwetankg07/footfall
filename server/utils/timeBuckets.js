// Bucket starts in a site's timezone, so "Tuesday 9pm" means 9pm where the site owner lives.

const offsetMinutes = (timeZone, date) => {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName").value; // "GMT+05:30" or "GMT"
  const match = name.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -minutes : minutes;
};

const UNIT_MS = { hour: 60 * 60 * 1000, day: 24 * 60 * 60 * 1000 };

export const truncate = (date, unit, timeZone) => {
  const offset = offsetMinutes(timeZone, date) * 60 * 1000;
  const local = date.getTime() + offset;
  return new Date(local - (((local % UNIT_MS[unit]) + UNIT_MS[unit]) % UNIT_MS[unit]) - offset);
};

// Every bucket start from `from` up to (not including) `to`.
// ponytail: steps by fixed 1h/24h, so a DST change shifts daily buckets by an hour; fine for IST, revisit for DST zones.
export const bucketStarts = (from, to, unit, timeZone) => {
  const starts = [];
  for (let t = truncate(from, unit, timeZone).getTime(); t < to.getTime(); t += UNIT_MS[unit]) {
    starts.push(new Date(t));
  }
  return starts;
};
