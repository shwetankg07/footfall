import mongoose from "mongoose";
import Site from "../models/site.model.js";
import User from "../models/user.model.js";
import Invite from "../models/invite.model.js";
import { isEmail } from "../utils/validate.js";
import { publicSite } from "./site.controller.js";
import { emitToUser } from "../socket.js";

const ROLES = ["admin", "viewer"];

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
  const invites = req.role === "viewer" ? [] : await Invite.find({ site: site._id, status: "pending" }).select("email role createdAt");

  res.json({ members: people, invites });
};

export const inviteMember = async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const { role } = req.body ?? {};

  if (!isEmail(email)) {
    return res.status(400).json({ message: "Enter a valid email address" });
  }
  if (!ROLES.includes(role)) {
    return res.status(400).json({ message: "Role must be admin or viewer" });
  }

  const invitee = await User.findOne({ email }).select("_id");
  const hasAccess = invitee && (req.site.owner.equals(invitee._id) || req.site.members.some((m) => m.user.equals(invitee._id)));
  if (hasAccess) {
    return res.status(409).json({ message: `${email} already has access` });
  }

  if (await Invite.exists({ site: req.site._id, email, status: "pending" })) {
    return res.status(409).json({ message: `${email} has already been invited` });
  }

  const invite = await Invite.create({ site: req.site._id, email, role, invitedBy: req.user._id });
  if (invitee) emitToUser(invitee._id, "invite", { siteName: req.site.name });

  res.status(201).json({ invite: { _id: invite._id, email, role, createdAt: invite.createdAt } });
};

export const cancelInvite = async (req, res) => {
  const deleted = await Invite.findOneAndDelete({ _id: req.params.inviteId, site: req.site._id, status: "pending" });
  if (!deleted) return res.status(404).json({ message: "Invite not found" });
  res.json({ message: `Invite for ${deleted.email} cancelled` });
};

export const changeRole = async (req, res) => {
  const { role } = req.body ?? {};
  if (!ROLES.includes(role)) {
    return res.status(400).json({ message: "Role must be admin or viewer" });
  }

  const member = req.site.members.find((m) => m.user.equals(req.params.userId));
  if (!member) return res.status(404).json({ message: "That person isn't a member of this site" });

  member.role = role;
  await req.site.save();
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

  const before = req.site.members.length;
  req.site.members = req.site.members.filter((m) => !m.user.equals(userId));
  if (req.site.members.length === before) {
    return res.status(404).json({ message: "That person isn't a member of this site" });
  }

  await req.site.save();
  res.json({ message: leaving ? "You left the site" : "Member removed" });
};

export const myInvites = async (req, res) => {
  const invites = await Invite.find({ email: req.user.email, status: "pending" })
    .populate("site", "name domain")
    .populate("invitedBy", "name")
    .sort({ createdAt: -1 });

  res.json({ invites: invites.filter((invite) => invite.site) });
};

const answer = (status) => async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.inviteId)) {
    return res.status(404).json({ message: "Invite not found" });
  }

  // Flipping the status in one step means a double click can't accept twice.
  const invite = await Invite.findOneAndUpdate(
    { _id: req.params.inviteId, email: req.user.email, status: "pending" },
    { status },
    { returnDocument: "after" }
  );
  if (!invite) {
    return res.status(404).json({ message: "This invite was already answered or cancelled" });
  }

  if (status === "declined") {
    return res.json({ message: "Invite declined" });
  }

  const me = req.user._id;
  const site = await Site.findOneAndUpdate(
    { _id: invite.site, owner: { $ne: me }, "members.user": { $ne: me } },
    { $push: { members: { user: me, role: invite.role } } },
    { returnDocument: "after" }
  );
  if (!site) {
    const existing = await Site.findById(invite.site);
    if (!existing) return res.status(404).json({ message: "That site no longer exists" });
    return res.json({ message: "You already have access", site: publicSite(existing, invite.role) });
  }

  res.json({ message: `You joined ${site.name}`, site: publicSite(site, invite.role) });
};

export const acceptInvite = answer("accepted");
export const declineInvite = answer("declined");
