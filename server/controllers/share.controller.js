import crypto from "node:crypto";
import Site from "../models/site.model.js";
import { statsFor } from "./stats.controller.js";
import { liveCount } from "../utils/live.js";

// Creating a link again replaces the old one, so a leaked link can be killed.
export const enableShare = async (req, res) => {
  req.site.shareToken = crypto.randomBytes(18).toString("base64url");
  await req.site.save();
  res.json({ shareToken: req.site.shareToken });
};

export const disableShare = async (req, res) => {
  req.site.shareToken = null;
  await req.site.save();
  res.json({ message: "Public link turned off" });
};

export const sharedSite = async (req, res, next) => {
  const { token } = req.params;
  const site = /^[\w-]{10,64}$/.test(token) ? await Site.findOne({ shareToken: token }) : null;

  if (!site) {
    return res.status(404).json({ message: "This link is not valid or was turned off" });
  }

  req.site = site;
  next();
};

export const getSharedSite = (req, res) => {
  const { name, domain, timezone } = req.site;
  res.json({ site: { name, domain, timezone, live: liveCount(req.site._id) } });
};

export const getSharedStats = async (req, res) => {
  const stats = await statsFor(req.site, req.query);
  if (stats.error) return res.status(400).json({ message: stats.error });
  res.json(stats);
};
