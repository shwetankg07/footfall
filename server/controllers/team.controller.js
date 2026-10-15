import mongoose from "mongoose";
import { createHash, randomBytes } from "node:crypto";
import Site from "../models/site.model.js";
import Invite from "../models/invite.model.js";
import { publicSite } from "./site.controller.js";
import { roleOf } from "../middlewares/site.middleware.js";
import { resetWatchers } from "../socket.js";

const ROLES = ["admin", "viewer"];
const INVITE_FIELDS = "role label expiresAt createdAt";
const INVALID_INVITE = "This invite link is invalid, expired or already used";
const hashToken = (token) => createHash("sha256").update(token).digest("hex");

const pendingInvite = (token, userId) => /^[A-Za-z0-9_-]{32}$/.test(token) ? {
  tokenHash: hashToken(token),
  status: "pending",
  expiresAt: { $gt: new Date() },
  $or: [{ acceptedBy: { $exists: false } }, { acceptedBy: userId }],
} : null;

export const listMembers = async (req, res) => {
  const site = await req.site.populate([
    { path: "owner", select: "name email" },
    { path: "members.user", select: "name email" },
  ]);

  const people = [
    { user: site.owner, role: "owner" },
    ...site.members.filter((member) => member.user).map((member) => ({ user: member.user, role: member.role })),
  ];

  // Only people who can manage the team see who's been invited.
  const invites = req.role === "viewer" ? [] : await Invite.find({ site: site._id, status: "pending", expiresAt: { $gt: new Date() } }).select(INVITE_FIELDS);

  res.json({ members: people, invites });
};

export const inviteMember = async (req, res) => {
  const { role, label } = req.body ?? {};

  if (!ROLES.includes(role)) {
    return res.status(400).json({ message: "Role must be admin or viewer" });
  }
  if (label !== undefined && typeof label !== "string") {
    return res.status(400).json({ message: "Label must be text" });
  }
  if (label?.trim().length > 80) {
    return res.status(400).json({ message: "Label must be 80 characters or fewer" });
  }

  const token = randomBytes(24).toString("base64url");
  const createdAt = new Date();
  const invite = await Invite.create({
    site: req.site._id,
    role,
    label: label?.trim(),
    invitedBy: req.user._id,
    tokenHash: hashToken(token),
    createdAt,
    expiresAt: new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000),
  });

  res.status(201).json({ invite: { _id: invite._id, role, label: invite.label, expiresAt: invite.expiresAt, createdAt: invite.createdAt }, token });
};

export const cancelInvite = async (req, res) => {
  const deleted = await Invite.findOneAndDelete({ _id: req.params.inviteId, site: req.site._id, status: "pending" });
  if (!deleted) return res.status(404).json({ message: "Invite not found" });
  res.json({ message: "Invite cancelled" });
};

export const changeRole = async (req, res) => {
  const { role } = req.body ?? {};
  if (!ROLES.includes(role)) {
    return res.status(400).json({ message: "Role must be admin or viewer" });
  }

  // Targeted update, so it can't overwrite someone who joined in the meantime.
  const result = mongoose.isValidObjectId(req.params.userId)
    ? await Site.updateOne({ _id: req.site._id, "members.user": req.params.userId }, { $set: { "members.$.role": role } })
    : { matchedCount: 0 };
  if (result.matchedCount === 0) return res.status(404).json({ message: "That person isn't a member of this site" });
  res.json({ message: `Role changed to ${role}` });
};

// Admins can remove anyone but the owner; anyone can remove themselves (leave the site).
export const removeMember = async (req, res) => {
  const { userId } = req.params;
  const leaving = req.user._id.equals(userId);

  if (req.site.owner.equals(userId)) {
    return res.status(400).json({ message: "The owner can't be removed. Delete the site instead." });
  }
  if (!leaving && req.role === "viewer") {
    return res.status(403).json({ message: "Only admins can do that" });
  }

  const result = mongoose.isValidObjectId(userId)
    ? await Site.updateOne({ _id: req.site._id }, { $pull: { members: { user: userId } } })
    : { modifiedCount: 0 };
  if (result.modifiedCount === 0) {
    return res.status(404).json({ message: "That person isn't a member of this site" });
  }

  resetWatchers(req.site._id);
  res.json({ message: leaving ? "You left the site" : "Member removed" });
};

export const previewInvite = async (req, res) => {
  const filter = pendingInvite(req.params.token, req.user._id);
  if (!filter) return res.status(404).json({ message: INVALID_INVITE });

  const invite = await Invite.findOne(filter)
    .populate("site", "name domain owner members")
    .populate("invitedBy", "name");
  if (!invite?.site) return res.status(404).json({ message: INVALID_INVITE });

  const site = invite.site;
  res.json({ invite: {
    site: { _id: site._id, name: site.name, domain: site.domain },
    role: invite.role,
    invitedBy: { name: invite.invitedBy?.name ?? "Someone" },
    expiresAt: invite.expiresAt,
    alreadyMember: Boolean(roleOf(site, req.user._id)),
  } });
};

export const acceptInvite = async (req, res) => {
  const me = req.user._id;
  const filter = pendingInvite(req.params.token, me);
  if (!filter) return res.status(404).json({ message: INVALID_INVITE });

  // Reserve the link for this account so two people can't join with it at once.
  // Keeping it pending lets this person retry if adding access is interrupted.
  const invite = await Invite.findOneAndUpdate(
    filter,
    { acceptedBy: me },
    { returnDocument: "after" }
  );
  if (!invite) return res.status(404).json({ message: INVALID_INVITE });

  const joined = await Site.findOneAndUpdate(
    { _id: invite.site, owner: { $ne: me }, "members.user": { $ne: me } },
    { $push: { members: { user: me, role: invite.role } } },
    { returnDocument: "after" }
  );
  const site = joined ?? await Site.findById(invite.site);
  if (!site) return res.status(404).json({ message: INVALID_INVITE });

  // Add access before consuming the link, so a retry can finish an interrupted accept.
  const accepted = await Invite.updateOne(
    { _id: invite._id, status: "pending", acceptedBy: me },
    { status: "accepted", acceptedBy: me }
  );
  if (accepted.modifiedCount === 0) return res.status(404).json({ message: INVALID_INVITE });

  res.json({ message: joined ? `You joined ${site.name}` : "You already have access", site: publicSite(site, roleOf(site, me)) });
};

export const declineInvite = async (req, res) => {
  const filter = pendingInvite(req.params.token, req.user._id);
  if (!filter) return res.status(404).json({ message: INVALID_INVITE });

  const declined = await Invite.findOneAndUpdate(
    { ...filter, acceptedBy: { $exists: false } },
    { status: "declined" }
  );
  if (!declined) return res.status(404).json({ message: INVALID_INVITE });
  res.json({ message: "Invite declined" });
};
