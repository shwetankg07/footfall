import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import rateLimit from "express-rate-limit";
import authRoutes from "./routes/auth.routes.js";
import { notFound, errorHandler } from "./middlewares/error.middleware.js";

const app = express();

export const allowedOrigins = process.env.CLIENT_URL.split(",").map((origin) => origin.trim());

// Render sits one proxy hop in front of us; without this req.ip is the proxy.
app.set("trust proxy", 1);

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { message: "Too many attempts, try again in a few minutes" } });

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.use("/api", cors({ origin: allowedOrigins, credentials: true }), express.json({ limit: "20kb" }), cookieParser());
app.use("/api/auth", authLimiter, authRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
