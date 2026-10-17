import Site from "../models/site.model.js";
import User from "../models/user.model.js";
import { planOf, hasIntelligence } from "../utils/plan.js";

const RANK = { viewer: 1, admin: 2, owner: 3 };

export const roleOf = (site, userId) => {
  if (site.owner.equals(userId)) return "owner";
  return site.members.find((member) => member.user.equals(userId))?.role ?? null;
};

// Loads req.site and checks the caller's role. Sites you can't see are a 404,
// not a 403, so ids can't be probed.
export const siteAccess = (minRole = "viewer") => async (req, res, next) => {
  const site = await Site.findById(req.params.siteId);
  const role = site && roleOf(site, req.user._id);

  if (!role) {
    return res.status(404).json({ message: "Site not found" });
  }

  if (RANK[role] < RANK[minRole]) {
    return res.status(403).json({ message: minRole === "owner" ? "Only the owner can do that" : "Only admins can do that" });
  }

  req.site = site;
  req.role = role;
  req.sitePlan = await sitePlan(site, req.user);
  next();
};

// A site gets what its owner pays for, whoever is looking at it.
export const sitePlan = async (site, viewer) => {
  const owner = viewer && site.owner.equals(viewer._id) ? viewer : await User.findById(site.owner).select("proUntil trialEndsAt");
  return planOf(owner);
};

export const requireIntelligence = (req, res, next) => {
  if (!hasIntelligence(req.sitePlan)) {
    return res.status(402).json({ message: "Intelligence is part of Footfall Pro. Upgrade to see forecasts, alerts and insights.", upgrade: true });
  }
  next();
};
