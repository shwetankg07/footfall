import Site from "../models/site.model.js";

// The collect endpoint looks up a site on every page view; cache by domain for a minute.
const TTL_MS = 60 * 1000;
const cache = new Map();

export const siteByDomain = async (domain) => {
  const hit = cache.get(domain);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.site;

  const site = await Site.findOne({ domain }).select("_id domain firstEventAt").lean();
  cache.set(domain, { site, at: Date.now() });
  return site;
};

export const forgetDomain = (domain) => cache.delete(domain);
