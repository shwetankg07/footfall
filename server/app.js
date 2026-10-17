import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import path from "node:path";
import authRoutes from "./routes/auth.routes.js";
import siteRoutes from "./routes/site.routes.js";
import inviteRoutes from "./routes/invite.routes.js";
import shareRoutes from "./routes/share.routes.js";
import alertRoutes from "./routes/alert.routes.js";
import billingRoutes from "./routes/billing.routes.js";
import { flushAlerts } from "./controllers/alert.controller.js";
import { collect } from "./controllers/collect.controller.js";
import { notFound, errorHandler } from "./middlewares/error.middleware.js";

const app = express();
app.disable("x-powered-by");

export const allowedOrigins = process.env.CLIENT_URL.split(",").map((origin) => origin.trim());

// Render sits one proxy hop in front of us; without this req.ip is the proxy.
app.set("trust proxy", 1);

// Keyed by email when there is one: behind the Vercel rewrite, many people share one IP.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => (typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : ipKeyGenerator(req.ip)),
  message: { message: "Too many attempts, try again in a few minutes" },
});

const collectLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false });

app.get("/health", (req, res) => res.json({ status: "ok" }));

// The tracker and its endpoint are public: any website can load t.js and post to /e.
app.get("/t.js", (req, res) => {
  res.set("Cache-Control", "public, max-age=3600");
  res.sendFile(path.join(import.meta.dirname, "public", "t.js"));
});
app.post("/e", collectLimiter, express.text({ type: "*/*", limit: "4kb" }), collect);

app.use("/api", cors({ origin: allowedOrigins, credentials: true }), express.json({ limit: "20kb" }), cookieParser());
app.use("/api/auth", (req, res, next) => (req.method === "POST" ? authLimiter(req, res, next) : next()), authRoutes);
app.use("/api/sites", siteRoutes);
app.use("/api/invites", inviteRoutes);
app.use("/api/share", shareRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/billing", billingRoutes);

// Called by the hourly ML job (GitHub Actions), authenticated with INTERNAL_SECRET.
app.post("/internal/alerts/flush", flushAlerts);

app.use(notFound);
app.use(errorHandler);

export default app;
