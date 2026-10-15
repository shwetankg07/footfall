// Who is on each site right now: siteId -> Map(visitor -> last seen ms).
// ponytail: in-process memory, so it assumes one API instance; move to Redis if we ever run two.
const WINDOW_MS = 5 * 60 * 1000;
const sites = new Map();
let emit = () => {};

export const onLiveChange = (fn) => {
  emit = fn;
};

const prune = (siteId, visitors, now) => {
  for (const [visitor, seen] of visitors) {
    if (now - seen > WINDOW_MS) visitors.delete(visitor);
  }
  if (visitors.size === 0) sites.delete(siteId);
};

export const liveCount = (siteId) => {
  const visitors = sites.get(String(siteId));
  if (!visitors) return 0;
  prune(String(siteId), visitors, Date.now());
  return visitors.size;
};

export const touch = (siteId, visitor) => {
  const id = String(siteId);
  if (!sites.has(id)) sites.set(id, new Map());
  const visitors = sites.get(id);
  const before = visitors.size;
  visitors.set(visitor, Date.now());
  if (visitors.size !== before) emit(id, visitors.size);
};

export const forget = (siteId) => sites.delete(String(siteId));

setInterval(() => {
  const now = Date.now();
  for (const [id, visitors] of sites) {
    const before = visitors.size;
    prune(id, visitors, now);
    if (visitors.size !== before) emit(id, visitors.size);
  }
}, 30 * 1000).unref();
