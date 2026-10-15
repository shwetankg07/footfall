import crypto from "node:crypto";
import Salt from "../models/salt.model.js";

let cached = { day: null, salt: null };

const saltForToday = async () => {
  const day = new Date().toISOString().slice(0, 10);
  if (cached.day === day) return cached.salt;

  // Upsert so two server instances racing at midnight agree on one salt.
  const doc = await Salt.findOneAndUpdate(
    { day },
    { $setOnInsert: { salt: crypto.randomBytes(32).toString("hex") } },
    { upsert: true, returnDocument: "after" }
  );
  cached = { day, salt: doc.salt };
  return doc.salt;
};

// Same person, same site, same day -> same id. No cookie, and the IP is never stored.
export const visitorId = async (siteId, ip, userAgent) => {
  const salt = await saltForToday();
  return crypto.createHash("sha256").update(`${salt}|${siteId}|${ip}|${userAgent}`).digest("hex");
};
