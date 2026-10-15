import { isbot } from "isbot";
import UAParser from "ua-parser-js";
import Event from "../models/event.model.js";
import Site from "../models/site.model.js";
import { normalizeDomain, hostMatches } from "../utils/domain.js";
import { siteByDomain, forgetDomain } from "../utils/siteCache.js";
import { visitorId } from "../utils/visitor.js";
import { touch } from "../utils/live.js";
import { emitToSite } from "../socket.js";

const hostOf = (url) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
};

const deviceOf = (ua) => {
  const type = ua.getDevice().type;
  return type === "mobile" || type === "tablet" ? type : "desktop";
};

// POST /e  body (text/plain JSON from sendBeacon): { d: domain, n: event name, u: page url, r: referrer }
export const collect = async (req, res) => {
  let body;
  try {
    body = JSON.parse(req.body);
  } catch {
    return res.status(400).json({ message: "Body must be JSON" });
  }

  const { d, n, u, r } = body ?? {};
  const domain = normalizeDomain(d);
  const name = typeof n === "string" ? n.trim().slice(0, 64) : "";

  let url;
  try {
    url = new URL(u);
  } catch {
    url = null;
  }

  if (!domain || !name || !url) {
    return res.status(400).json({ message: "d, n and u are required" });
  }

  const userAgent = req.get("user-agent") ?? "";

  // Bots get a 202 like everyone else so they have nothing to learn from.
  if (isbot(userAgent)) return res.status(202).end();

  const site = await siteByDomain(domain);
  if (!site) return res.status(404).json({ message: "Unknown site" });

  // The browser sets Origin itself, so a page on another domain can't pretend to be this site.
  const origin = hostOf(req.get("origin") ?? req.get("referer") ?? "");
  if (!origin || !hostMatches(origin, site.domain) || !hostMatches(hostOf(url.href) ?? "", site.domain)) {
    return res.status(403).json({ message: "Event does not come from this site" });
  }

  const referrerHost = typeof r === "string" ? hostOf(r) : null;
  const ua = new UAParser(userAgent);
  const visitor = await visitorId(site._id, req.ip, userAgent);

  await Event.create({
    site: site._id,
    ts: new Date(),
    name,
    path: url.pathname.slice(0, 512) || "/",
    referrer: referrerHost && !hostMatches(referrerHost, site.domain) ? referrerHost : null,
    utmSource: url.searchParams.get("utm_source")?.slice(0, 64) || null,
    device: deviceOf(ua),
    browser: ua.getBrowser().name ?? "Unknown",
    os: ua.getOS().name ?? "Unknown",
    country: req.get("cf-ipcountry")?.slice(0, 2).toUpperCase() || null,
    visitor,
  });

  if (!site.firstEventAt) {
    const first = await Site.updateOne({ _id: site._id, firstEventAt: null }, { firstEventAt: new Date() });
    if (first.modifiedCount) {
      forgetDomain(site.domain);
      emitToSite(site._id, "installed", { siteId: String(site._id) });
    }
  }

  touch(site._id, visitor);
  res.status(202).end();
};
