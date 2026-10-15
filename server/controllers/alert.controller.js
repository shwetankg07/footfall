import crypto from "node:crypto";
import mongoose from "mongoose";
import Alert from "../models/alert.model.js";
import Site from "../models/site.model.js";
import { roleOf } from "../middlewares/site.middleware.js";
import { emitToUser } from "../socket.js";
import { sendEmail, escapeHtml } from "../utils/email.js";

const mySiteIds = async (userId) =>
  (await Site.find({ $or: [{ owner: userId }, { "members.user": userId }] }).select("_id")).map((site) => site._id);

export const describeAlert = (alert, site) => {
  const when = new Intl.DateTimeFormat("en-IN", {
    timeZone: site.timezone, weekday: "short", hour: "numeric", minute: "2-digit",
  }).format(alert.hour);
  const range = `${Math.round(alert.lo)} to ${Math.round(alert.hi)}`;
  return alert.kind === "spike"
    ? `Traffic spike on ${site.domain}: ${alert.actual} page views in the hour from ${when}. Normal is ${range}.`
    : `Traffic drop on ${site.domain}: ${alert.actual} page views in the hour from ${when}. Normal is ${range}.`;
};

const shape = (alert, userId) => ({
  _id: alert._id,
  site: { _id: alert.site._id, name: alert.site.name, domain: alert.site.domain },
  hour: alert.hour,
  kind: alert.kind,
  actual: alert.actual,
  expected: alert.expected,
  lo: alert.lo,
  hi: alert.hi,
  message: describeAlert(alert, alert.site),
  read: alert.readBy.some((id) => id.equals(userId)),
});

export const listAlerts = async (req, res) => {
  let siteIds = await mySiteIds(req.user._id);

  if (req.query.site !== undefined) {
    siteIds = mongoose.isValidObjectId(req.query.site) ? siteIds.filter((id) => id.equals(req.query.site)) : [];
    if (siteIds.length === 0) return res.status(404).json({ message: "Site not found" });
  }

  const alerts = await Alert.find({ site: { $in: siteIds } }).sort({ hour: -1 }).limit(50).populate("site", "name domain timezone");
  const shaped = alerts.filter((alert) => alert.site).map((alert) => shape(alert, req.user._id));
  res.json({ alerts: shaped, unread: shaped.filter((alert) => !alert.read).length });
};

export const markRead = async (req, res) => {
  const result = await Alert.updateOne(
    { _id: req.params.alertId, site: { $in: await mySiteIds(req.user._id) } },
    { $addToSet: { readBy: req.user._id } }
  );
  if (result.matchedCount === 0) return res.status(404).json({ message: "Alert not found" });
  res.json({ message: "Marked as read" });
};

export const markAllRead = async (req, res) => {
  await Alert.updateMany({ site: { $in: await mySiteIds(req.user._id) } }, { $addToSet: { readBy: req.user._id } });
  res.json({ message: "All alerts marked as read" });
};

const secretOk = (given) => {
  const expected = Buffer.from(process.env.INTERNAL_SECRET);
  const actual = Buffer.from(String(given ?? ""));
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};

// Called by the hourly ML job after it writes new alerts. Safe to call any number of times.
export const flushAlerts = async (req, res) => {
  if (!secretOk(req.get("x-internal-secret"))) {
    return res.status(401).json({ message: "Bad internal secret" });
  }

  const pending = await Alert.find({ notifiedAt: null }).sort({ hour: 1 }).limit(100);
  let notified = 0;

  for (const alert of pending) {
    // Claim it first, so two overlapping calls never notify twice.
    const claim = await Alert.updateOne({ _id: alert._id, notifiedAt: null }, { notifiedAt: new Date() });
    if (claim.modifiedCount === 0) continue;

    const site = await Site.findById(alert.site).populate("owner", "email").populate("members.user", "email");
    if (!site) continue;

    const message = describeAlert(alert, site);
    const people = [site.owner, ...site.members.map((m) => m.user)].filter(Boolean);
    for (const person of people) {
      emitToUser(person._id, "alert", { siteId: String(site._id), message });
    }

    const emailTo = people.filter((person) => ["owner", "admin"].includes(roleOf(site, person._id))).map((p) => p.email);
    await sendEmail({
      to: emailTo,
      subject: `${alert.kind === "spike" ? "Traffic spike" : "Traffic drop"} on ${site.domain}`,
      html: `<p>${escapeHtml(message)}</p><p>Open your Footfall dashboard to see what changed.</p>`,
    });
    notified += 1;
  }

  res.json({ notified });
};
