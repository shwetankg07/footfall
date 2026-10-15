import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import rateLimit from "express-rate-limit";
import path from "node:path";
import authRoutes from "./routes/auth.routes.js";
import siteRoutes from "./routes/site.routes.js";
import { collect } from "./controllers/collect.controller.js";
import { notFound, errorHandler } from "./middlewares/error.middleware.js";

const app = express();
app.disable("x-powered-by");

export const allowedOrigins = process.env.CLIENT_URL.split(",").map((origin) => origin.trim());

// Render sits one proxy hop in front of us; without this req.ip is the proxy.
app.set("trust proxy", 1);

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { message: "Too many attempts, try again in a few minutes" } });

const collectLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false });

app.get("/health", (req, res) => res.json({ status: "ok" }));

// The tracker and its endpoint are public: any website can load t.js and post to /e.
app.get("/t.js", (req, res) => {
  res.set("Cache-Control", "public, max-age=3600");
  res.sendFile(path.join(import.meta.dirname, "public", "t.js"));
});
app.post("/e", collectLimiter, express.text({ type: "*/*", limit: "4kb" }), collect);

app.use("/api", cors({ origin: allowedOrigins, credentials: true }), express.json({ limit: "20kb" }), cookieParser());
app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/sites", siteRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
