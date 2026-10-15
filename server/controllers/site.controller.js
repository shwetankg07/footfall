import Site from "../models/site.model.js";
import Event from "../models/event.model.js";
import Funnel from "../models/funnel.model.js";
import Invite from "../models/invite.model.js";
import Alert from "../models/alert.model.js";
import Forecast from "../models/forecast.model.js";
import { filled } from "../utils/validate.js";
import { normalizeDomain } from "../utils/domain.js";
import { forgetDomain } from "../utils/siteCache.js";
import { liveCount, forget } from "../utils/live.js";
import { roleOf } from "../middlewares/site.middleware.js";

const TIMEZONES = new Set(Intl.supportedValuesOf("timeZone"));

export const publicSite = (site, role) => ({
  _id: site._id,
  name: site.name,
  domain: site.domain,
  timezone: site.timezone,
  role,
  installed: Boolean(site.firstEventAt),
  // Only people who can manage sharing need to see the token.
  shareToken: role === "viewer" ? undefined : site.shareToken,
  createdAt: site.createdAt,
});

export const listSites = async (req, res) => {
  const me = req.user._id;
  const sites = await Site.find({ $or: [{ owner: me }, { "members.user": me }] }).sort({ createdAt: 1 });

  // Last-24h numbers for every site in one query, for the site cards.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const totals = await Event.aggregate([
    { $match: { site: { $in: sites.map((site) => site._id) }, ts: { $gte: since }, name: "pageview" } },
    { $group: { _id: "$site", pageviews: { $sum: 1 }, visitors: { $addToSet: "$visitor" } } },
    { $project: { pageviews: 1, visitors: { $size: "$visitors" } } },
  ]);
  const bySite = new Map(totals.map((row) => [String(row._id), row]));

  res.json({
    sites: sites.map((site) => ({
      ...publicSite(site, roleOf(site, me)),
      last24h: { pageviews: bySite.get(String(site._id))?.pageviews ?? 0, visitors: bySite.get(String(site._id))?.visitors ?? 0 },
      live: liveCount(site._id),
    })),
  });
};

export const createSite = async (req, res) => {
  const { name, domain } = req.body ?? {};

  if (!filled(name, domain)) {
    return res.status(400).json({ message: "Name and domain are required" });
  }

  const cleanDomain = normalizeDomain(domain);
  if (!cleanDomain) {
    return res.status(400).json({ message: "Enter a domain like example.com" });
  }

  if (await Site.exists({ domain: cleanDomain })) {
    return res.status(409).json({ message: `${cleanDomain} is already on Footfall` });
  }

  const site = await Site.create({ name: name.trim().slice(0, 80), domain: cleanDomain, owner: req.user._id });
  forgetDomain(cleanDomain);
  res.status(201).json({ site: publicSite(site, "owner") });
};

export const getSite = (req, res) => {
  res.json({ site: { ...publicSite(req.site, req.role), live: liveCount(req.site._id) } });
};

export const updateSite = async (req, res) => {
  const { name, timezone } = req.body ?? {};

  if (name !== undefined) {
    if (!filled(name)) return res.status(400).json({ message: "Name can't be empty" });
    req.site.name = name.trim().slice(0, 80);
  }

  if (timezone !== undefined) {
    if (!TIMEZONES.has(timezone)) return res.status(400).json({ message: "Unknown timezone" });
    req.site.timezone = timezone;
  }

  await req.site.save();
  res.json({ site: publicSite(req.site, req.role) });
};

export const deleteSite = async (req, res) => {
  const site = req.site;
  await Promise.all([Event, Funnel, Invite, Alert, Forecast].map((Model) => Model.deleteMany({ site: site._id })));
  await site.deleteOne();
  forgetDomain(site.domain);
  forget(site._id);
  res.json({ message: `${site.domain} and all its data were deleted` });
};
