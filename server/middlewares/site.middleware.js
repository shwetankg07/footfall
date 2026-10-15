import Site from "../models/site.model.js";

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
  next();
};
