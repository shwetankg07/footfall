// End-to-end: starts the real server against an in-memory MongoDB and walks every workflow.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { io } from "socket.io-client";
import Event from "./models/event.model.js";
import Alert from "./models/alert.model.js";
import Forecast from "./models/forecast.model.js";
import Invite from "./models/invite.model.js";
import Site from "./models/site.model.js";

const PORT = 8098;
const BASE = `http://localhost:${PORT}`;
const SECRET = "test-internal-secret";
const mongo = await MongoMemoryServer.create();

const server = spawn("node", ["index.js"], {
  env: {
    ...process.env, PORT: String(PORT), MONGO_URI: mongo.getUri(), MONGO_DB: "footfall-test",
    JWT_SECRET: "test-secret", CLIENT_URL: "http://localhost:5173", INTERNAL_SECRET: SECRET,
    RESEND_API_KEY: "", NODE_ENV: "test",
  },
  stdio: ["ignore", "pipe", "inherit"],
});
await new Promise((resolve) => server.stdout.on("data", (d) => String(d).includes("Server running") && resolve()));
await mongoose.connect(mongo.getUri(), { dbName: "footfall-test" });

const call = async (method, path, { body, cookie, headers = {} } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body !== undefined && { "Content-Type": "application/json" }), ...(cookie && { Cookie: cookie }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, cookie: res.headers.get("set-cookie")?.split(";")[0] };
};

const CHROME = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const track = (domain, name, url, { origin = `https://${domain}`, ua = CHROME, referrer = null } = {}) =>
  fetch(`${BASE}/e`, {
    method: "POST",
    headers: { "Content-Type": "text/plain", Origin: origin, "User-Agent": ua },
    body: JSON.stringify({ d: domain, n: name, u: url, r: referrer }),
  }).then((res) => res.status);

const signup = async (name, email) => {
  const res = await call("POST", "/api/auth/register", { body: { name, email, password: "password123" } });
  assert.equal(res.status, 201, `register ${email}`);
  return res.cookie;
};

try {
  // Accounts
  const asha = await signup("Asha", "asha@example.com");
  const bob = await signup("Bob", "bob@example.com");
  const eve = await signup("Eve", "eve@example.com");
  assert.equal((await call("POST", "/api/auth/register", { body: { name: "A", email: "ASHA@example.com", password: "password123" } })).status, 409);
  assert.equal((await call("POST", "/api/auth/register", { body: { name: "A", email: { $gt: "" }, password: "password123" } })).status, 400);
  assert.equal((await call("POST", "/api/auth/register", { body: { name: "A", email: "a@b.co", password: "short" } })).status, 400);
  assert.equal((await call("POST", "/api/auth/login", { body: { email: "asha@example.com", password: "nope-nope" } })).status, 401);
  const login = await call("POST", "/api/auth/login", { body: { email: "asha@example.com", password: "password123" } });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.password, undefined, "password never leaves the server");
  assert.equal((await call("GET", "/api/auth/me")).status, 401);

  // Sites
  assert.equal((await call("POST", "/api/sites", { cookie: asha, body: { name: "Shop", domain: "not a domain" } })).status, 400);
  let res = await call("POST", "/api/sites", { cookie: asha, body: { name: "Shop", domain: "https://www.Shop.example.com/home" } });
  assert.equal(res.status, 201);
  assert.equal(res.body.site.domain, "shop.example.com");
  assert.equal(res.body.site.installed, false);
  const siteId = res.body.site._id;
  assert.equal((await call("POST", "/api/sites", { cookie: eve, body: { name: "Copy", domain: "shop.example.com" } })).status, 409);
  assert.equal((await call("GET", `/api/sites/${siteId}`, { cookie: eve })).status, 404, "strangers can't see a site");
  assert.equal((await call("GET", "/api/sites/not-an-id", { cookie: asha })).status, 404);

  // Live count over the socket, before any traffic arrives. Sockets log in with a 2-minute token, not the cookie.
  const { token: socketToken } = (await call("GET", "/api/auth/socket-token", { cookie: asha })).body;
  assert.equal((await call("GET", "/api/auth/me", { cookie: `token=${socketToken}` })).status, 401, "a socket token is not a login");
  assert.equal((await call("GET", "/api/auth/socket-token")).status, 401);
  const socket = io(BASE, { auth: { token: socketToken }, transports: ["websocket"] });
  await new Promise((resolve) => socket.on("connect", resolve));
  socket.emit("watch", {}, "not-a-function");
  socket.emit("watch", null);
  const watched = await new Promise((resolve) => socket.emit("watch", { siteId }, resolve));
  assert.deepEqual(watched, { ok: true, live: 0 });
  const stranger = io(BASE, { auth: { token: "garbage" }, transports: ["websocket"] });
  assert.deepEqual(await new Promise((resolve) => stranger.on("connect", () => stranger.emit("watch", { siteId }, resolve))), { ok: false }, "no token, no private site");
  const installed = new Promise((resolve) => socket.once("installed", resolve));
  const liveUpdate = new Promise((resolve) => socket.once("live", resolve));

  // Collecting
  const home = "https://shop.example.com/";
  assert.equal(await track("shop.example.com", "pageview", home, { referrer: "https://www.google.com/search?q=x" }), 202);
  assert.equal((await liveUpdate).count, 1);
  await installed;
  assert.equal(await track("shop.example.com", "pageview", "https://shop.example.com/product/keyboard", { referrer: home }), 202);
  assert.equal(await track("shop.example.com", "paid", "https://shop.example.com/checkout"), 202);
  assert.equal(await track("shop.example.com", "pageview", "https://shop.example.com/?utm_source=linkedin", { ua: IPHONE }), 202);
  assert.equal(await track("shop.example.com", "pageview", home, { origin: "https://evil.example.org" }), 403, "other sites can't send events");
  assert.equal(await track("shop.example.com", "pageview", "https://evil.example.org/"), 403, "url must be on the site");
  assert.equal(await track("shop.example.com", "pageview", home, { ua: "Googlebot/2.1 (+http://www.google.com/bot.html)" }), 202);
  assert.equal(await track("nobody.example.com", "pageview", "https://nobody.example.com/"), 404);
  assert.equal(await fetch(`${BASE}/e`, { method: "POST", body: "{nope" }).then((r) => r.status), 400);

  const stored = await Event.find().sort({ ts: 1 }).lean();
  assert.equal(stored.length, 4, "the bot and the rejected events are not stored");
  assert.equal(stored[0].referrer, "google.com");
  assert.equal(stored[1].referrer, null, "same-site referrers are dropped");
  assert.equal(stored[3].device, "mobile");
  assert.equal(stored[3].utmSource, "linkedin");
  assert.equal(stored[0].visitor, stored[1].visitor, "same browser, same day, same visitor");
  assert.notEqual(stored[0].visitor, stored[3].visitor);
  assert.ok(!JSON.stringify(stored).includes("127.0.0.1") && !JSON.stringify(stored).includes("::1"), "IPs are never stored");

  // Stats
  res = await call("GET", `/api/sites/${siteId}/stats`, { cookie: asha });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.summary, { visitors: 2, pageviews: 3, viewsPerVisitor: 1.5, bounceRate: 50 });
  assert.equal(res.body.range.unit, "day");
  assert.equal(res.body.series.reduce((sum, point) => sum + point.pageviews, 0), 3);
  assert.deepEqual(res.body.events, [{ name: "paid", count: 1, visitors: 1 }]);
  assert.equal(res.body.devices.find((d) => d.device === "mobile").visitors, 1);
  assert.equal((await call("GET", `/api/sites/${siteId}/stats?from=2026-01-02&to=2026-01-01`, { cookie: asha })).status, 400);
  assert.equal((await call("GET", `/api/sites/${siteId}/stats`, { cookie: eve })).status, 404);
  res = await call("GET", "/api/sites", { cookie: asha });
  assert.equal(res.body.sites[0].installed, true);
  assert.deepEqual(res.body.sites[0].last24h, { pageviews: 3, visitors: 2 });

  // Funnels
  const steps = [{ kind: "page", value: "/" }, { kind: "page", value: "/product/*" }, { kind: "event", value: "paid" }];
  assert.equal((await call("POST", `/api/sites/${siteId}/funnels`, { cookie: asha, body: { name: "Buy", steps: steps.slice(0, 1) } })).status, 400);
  res = await call("POST", `/api/sites/${siteId}/funnels`, { cookie: asha, body: { name: "Buy", steps } });
  assert.equal(res.status, 201);
  const funnelId = res.body.funnel._id;
  res = await call("GET", `/api/sites/${siteId}/funnels/${funnelId}`, { cookie: asha });
  assert.deepEqual(res.body.steps.map((s) => [s.visitors, s.kept]), [[2, null], [1, 50], [1, 100]]);

  // Team: single-use invite links, accept, roles
  const invalidInvite = "This invite link is invalid, expired or already used";
  assert.equal((await call("POST", `/api/sites/${siteId}/invites`, { cookie: asha, body: { role: "owner" } })).status, 400);
  for (const label of [null, 123, {}, [], "x".repeat(81)]) {
    assert.equal((await call("POST", `/api/sites/${siteId}/invites`, { cookie: asha, body: { role: "viewer", label } })).status, 400);
  }
  res = await call("POST", `/api/sites/${siteId}/invites`, { cookie: asha, body: { label: "  eve@example.com  ", role: "viewer" } });
  assert.equal(res.status, 201);
  const { token: inviteToken, invite: createdInvite } = res.body;
  const inviteId = createdInvite._id;
  assert.match(inviteToken, /^[A-Za-z0-9_-]{32}$/);
  assert.deepEqual(Object.keys(createdInvite).sort(), ["_id", "createdAt", "expiresAt", "label", "role"]);
  assert.equal(createdInvite.label, "eve@example.com");
  assert.equal(new Date(createdInvite.expiresAt) - new Date(createdInvite.createdAt), 7 * 24 * 60 * 60 * 1000);
  const storedInvite = await Invite.findById(inviteId).lean();
  assert.equal(storedInvite.tokenHash, createHash("sha256").update(inviteToken).digest("hex"));
  assert.equal(storedInvite.token, undefined, "the raw token is never stored");
  assert.equal(storedInvite.email, undefined);

  res = await call("GET", `/api/sites/${siteId}/members`, { cookie: asha });
  assert.equal(res.body.invites.length, 1);
  assert.deepEqual(res.body.invites[0], createdInvite, "members only returns public invite metadata");
  assert.ok(res.body.invites.every((invite) => !("token" in invite) && !("tokenHash" in invite)));
  assert.equal((await call("GET", "/api/invites", { cookie: bob })).status, 404, "there is no email-matched invite list");
  assert.equal((await call("POST", `/api/invites/${inviteId}/accept`, { cookie: bob })).status, 404, "invite ids don't grant access");
  assert.equal((await call("GET", `/api/invites/${inviteToken}`)).status, 401);
  for (const path of ["not-a-token", "x".repeat(32)]) {
    for (const [method, suffix] of [["GET", ""], ["POST", "/accept"], ["POST", "/decline"]]) {
      res = await call(method, `/api/invites/${path}${suffix}`, { cookie: bob });
      assert.equal(res.status, 404);
      assert.equal(res.body.message, invalidInvite);
    }
  }

  res = await call("GET", `/api/invites/${inviteToken}`, { cookie: bob });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.invite, {
    site: { _id: siteId, name: "Shop", domain: "shop.example.com" },
    role: "viewer", invitedBy: { name: "Asha" }, expiresAt: createdInvite.expiresAt, alreadyMember: false,
  });
  res = await call("POST", `/api/invites/${inviteToken}/accept`, { cookie: bob });
  assert.equal(res.status, 200, "possession of the link grants access, regardless of the display label");
  assert.equal(res.body.message, "You joined Shop");
  assert.equal(res.body.site.role, "viewer");
  assert.equal((await call("POST", `/api/invites/${inviteToken}/accept`, { cookie: eve })).status, 404, "a link only admits one person");
  assert.equal((await call("GET", `/api/invites/${inviteToken}`, { cookie: eve })).status, 404);
  assert.equal((await call("GET", `/api/sites/${siteId}`, { cookie: eve })).status, 404);
  assert.equal((await call("POST", `/api/invites/${inviteToken}/accept`, { cookie: bob })).status, 404, "can't accept twice");
  assert.equal((await call("GET", `/api/sites/${siteId}/stats`, { cookie: bob })).status, 200, "viewer can read");
  assert.equal((await call("POST", `/api/sites/${siteId}/invites`, { cookie: bob, body: { role: "viewer" } })).status, 403, "viewers can't create invite links");
  assert.equal((await call("POST", `/api/sites/${siteId}/funnels`, { cookie: bob, body: { name: "x", steps } })).status, 403, "viewer can't write");
  assert.equal((await call("POST", `/api/sites/${siteId}/share`, { cookie: bob })).status, 403);
  res = await call("GET", `/api/sites/${siteId}/members`, { cookie: bob });
  assert.deepEqual(res.body.members.map((m) => m.role), ["owner", "viewer"]);
  assert.deepEqual(res.body.invites, [], "viewers don't see pending invites");
  const bobId = res.body.members[1].user._id;
  const ashaId = res.body.members[0].user._id;
  const acceptedInvite = await Invite.findById(inviteId);
  assert.equal(acceptedInvite.status, "accepted");
  assert.equal(String(acceptedInvite.acceptedBy), bobId);

  // Existing members keep their roles, including when the invite offers more access.
  res = await call("POST", `/api/sites/${siteId}/invites`, { cookie: asha, body: { role: "admin" } });
  const memberToken = res.body.token;
  assert.equal((await call("GET", `/api/invites/${memberToken}`, { cookie: bob })).body.invite.alreadyMember, true);
  res = await call("POST", `/api/invites/${memberToken}/accept`, { cookie: bob });
  assert.equal(res.body.message, "You already have access");
  assert.equal(res.body.site.role, "viewer");
  assert.equal(res.body.site.shareToken, undefined);
  assert.equal((await call("GET", `/api/sites/${siteId}`, { cookie: bob })).body.site.role, "viewer");

  res = await call("POST", `/api/sites/${siteId}/invites`, { cookie: asha, body: { role: "viewer", label: "Owner" } });
  const ownerToken = res.body.token;
  const ownerInviteId = res.body.invite._id;
  assert.equal((await call("GET", `/api/invites/${ownerToken}`, { cookie: asha })).body.invite.alreadyMember, true);
  res = await call("POST", `/api/invites/${ownerToken}/accept`, { cookie: asha });
  assert.equal(res.status, 200);
  assert.equal(res.body.message, "You already have access");
  assert.equal(res.body.site.role, "owner");
  assert.equal(String((await Invite.findById(ownerInviteId)).acceptedBy), ashaId);
  assert.equal((await call("POST", `/api/invites/${ownerToken}/accept`, { cookie: eve })).status, 404);

  assert.equal((await call("PATCH", `/api/sites/${siteId}/members/${bobId}`, { cookie: asha, body: { role: "admin" } })).status, 200);
  assert.equal((await call("POST", `/api/sites/${siteId}/funnels`, { cookie: bob, body: { name: "Bob's", steps } })).status, 201, "admin can write");
  assert.equal((await call("DELETE", `/api/sites/${siteId}`, { cookie: bob })).status, 403, "only the owner deletes");

  res = await call("POST", `/api/sites/${siteId}/invites`, { cookie: bob, body: { role: "viewer", label: "Expired" } });
  assert.equal(res.status, 201, "admins can create invite links");
  const expiredToken = res.body.token;
  const expiredInviteId = res.body.invite._id;
  await Invite.updateOne({ _id: expiredInviteId }, { expiresAt: new Date(Date.now() - 1000) });
  for (const [method, suffix] of [["GET", ""], ["POST", "/accept"], ["POST", "/decline"]]) {
    res = await call(method, `/api/invites/${expiredToken}${suffix}`, { cookie: eve });
    assert.equal(res.status, 404);
    assert.equal(res.body.message, invalidInvite);
  }
  assert.deepEqual((await call("GET", `/api/sites/${siteId}/members`, { cookie: asha })).body.invites, [], "expired invites aren't listed");

  res = await call("POST", `/api/sites/${siteId}/invites`, { cookie: bob, body: { role: "admin", label: "Decline" } });
  const declinedToken = res.body.token;
  const declinedInviteId = res.body.invite._id;
  res = await call("POST", `/api/invites/${declinedToken}/decline`, { cookie: eve });
  assert.equal(res.status, 200);
  assert.equal(res.body.message, "Invite declined");
  assert.equal((await Invite.findById(declinedInviteId)).status, "declined");
  assert.equal((await call("POST", `/api/invites/${declinedToken}/decline`, { cookie: eve })).status, 404);
  assert.equal((await call("POST", `/api/invites/${declinedToken}/accept`, { cookie: eve })).status, 404);
  assert.equal((await call("GET", `/api/invites/${declinedToken}`, { cookie: eve })).status, 404);

  res = await call("POST", `/api/sites/${siteId}/invites`, { cookie: bob, body: { role: "viewer" } });
  const cancelledToken = res.body.token;
  const cancelledInviteId = res.body.invite._id;
  assert.equal((await call("DELETE", `/api/sites/${siteId}/invites/${cancelledInviteId}`, { cookie: bob })).status, 200);
  assert.equal((await call("GET", `/api/invites/${cancelledToken}`, { cookie: eve })).status, 404);
  assert.equal((await call("POST", `/api/invites/${cancelledToken}/accept`, { cookie: eve })).status, 404);
  assert.equal(await Invite.findById(cancelledInviteId), null);

  // Even simultaneous accepts from different accounts only add one member.
  res = await call("POST", "/api/sites", { cookie: asha, body: { name: "Team", domain: "team.example.com" } });
  const teamSiteId = res.body.site._id;
  res = await call("POST", `/api/sites/${teamSiteId}/invites`, { cookie: asha, body: { role: "viewer" } });
  const raceToken = res.body.token;
  const raceInviteId = res.body.invite._id;
  const answers = await Promise.all([bob, eve].map((cookie) => call("POST", `/api/invites/${raceToken}/accept`, { cookie })));
  assert.deepEqual(answers.map((answer) => answer.status).sort(), [200, 404]);
  const raceSite = await Site.findById(teamSiteId);
  const raceInvite = await Invite.findById(raceInviteId);
  assert.equal(raceSite.members.length, 1);
  assert.equal(String(raceInvite.acceptedBy), String(raceSite.members[0].user));

  // Simulate a crash after adding membership, before consuming the invite.
  await Invite.updateOne({ _id: raceInviteId }, { status: "pending" });
  const winner = answers[0].status === 200 ? bob : eve;
  const loser = answers[0].status === 200 ? eve : bob;
  assert.equal((await call("POST", `/api/invites/${raceToken}/accept`, { cookie: loser })).status, 404);
  res = await call("POST", `/api/invites/${raceToken}/accept`, { cookie: winner });
  assert.equal(res.status, 200);
  assert.equal(res.body.message, "You already have access");
  assert.equal((await Site.findById(teamSiteId)).members.length, 1, "retrying doesn't add duplicate members");
  assert.equal((await Invite.findById(raceInviteId)).status, "accepted");
  assert.equal((await call("DELETE", `/api/sites/${teamSiteId}`, { cookie: asha })).status, 200);

  // Public share link
  res = await call("POST", `/api/sites/${siteId}/share`, { cookie: asha });
  const token = res.body.shareToken;
  res = await call("GET", `/api/share/${token}/stats`);
  assert.equal(res.status, 200);
  assert.equal(res.body.summary.pageviews, 3);
  assert.equal((await call("GET", `/api/share/${token}`)).body.site.domain, "shop.example.com");
  const viaLink = await new Promise((resolve) => stranger.emit("watch", { shareToken: token }, resolve));
  assert.equal(viaLink.ok, true, "share links can watch the live count");
  const rewatch = new Promise((resolve) => stranger.once("rewatch", resolve));
  await call("DELETE", `/api/sites/${siteId}/share`, { cookie: asha });
  await rewatch;
  assert.equal((await new Promise((resolve) => stranger.emit("watch", { shareToken: token }, resolve))).ok, false, "turned-off links lose the live feed");
  assert.equal((await call("GET", `/api/share/${token}/stats`)).status, 404, "turned-off links stop working");

  // Forecast band and alerts from the ML job
  const hour = new Date("2026-10-13T15:30:00Z");
  await Forecast.create({ site: siteId, hour, expected: 11, lo: 4, hi: 17, model: "test", updatedAt: new Date() });
  res = await call("GET", `/api/sites/${siteId}/forecast?from=2026-10-13T00:00:00Z&to=2026-10-14T00:00:00Z`, { cookie: bob });
  assert.deepEqual(res.body.points.map((p) => p.expected), [11]);

  await Alert.create({ site: siteId, hour, kind: "spike", actual: 38, expected: 11, lo: 4, hi: 17, score: 1e-9, model: "test" });
  const alertEvent = new Promise((resolve) => socket.once("alert", resolve));
  assert.equal((await call("POST", "/internal/alerts/flush", { headers: { "x-internal-secret": "wrong" } })).status, 401);
  assert.deepEqual((await call("POST", "/internal/alerts/flush", { headers: { "x-internal-secret": SECRET } })).body, { notified: 1, emailed: 0 });
  assert.equal((await call("POST", "/internal/alerts/flush", { headers: { "x-internal-secret": SECRET } })).body.notified, 0, "flush is idempotent");
  assert.match((await alertEvent).message, /Traffic spike on shop\.example\.com: 38 page views/);
  res = await call("GET", "/api/alerts", { cookie: bob });
  assert.equal(res.body.unread, 1);
  assert.match(res.body.alerts[0].message, /Normal is 4 to 17/);
  assert.equal((await call("POST", `/api/alerts/${res.body.alerts[0]._id}/read`, { cookie: bob })).status, 200);
  assert.equal((await call("GET", "/api/alerts", { cookie: bob })).body.unread, 0);
  assert.equal((await call("GET", "/api/alerts", { cookie: asha })).body.unread, 1, "read state is per person");
  assert.equal((await call("GET", "/api/alerts", { cookie: eve })).body.alerts.length, 0);

  // Leaving and deleting
  assert.equal((await call("DELETE", `/api/sites/${siteId}/members/${bobId}`, { cookie: bob })).status, 200, "members can leave");
  assert.equal((await call("GET", `/api/sites/${siteId}`, { cookie: bob })).status, 404);
  assert.equal((await call("DELETE", `/api/sites/${siteId}`, { cookie: asha })).status, 200);
  assert.equal(await Event.countDocuments(), 0, "deleting a site deletes its data");
  assert.equal(await Alert.countDocuments(), 0);

  socket.close();
  stranger.close();
  console.log("All server tests passed");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  server.kill();
  await mongoose.disconnect();
  await mongo.stop();
}
