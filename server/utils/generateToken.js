import jwt from "jsonwebtoken";

export const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "7d" });
};

// Sockets connect straight to the API's own domain, where the cookie isn't sent,
// so they authenticate with this short-lived token instead.
export const generateSocketToken = (userId) => {
  return jwt.sign({ id: userId, purpose: "socket" }, process.env.JWT_SECRET, { expiresIn: "2m" });
};

const isProduction = process.env.NODE_ENV === "production";

// The dashboard calls the API through its own origin (Vercel rewrite in production,
// Vite proxy in dev), so the cookie is first-party: Lax works in Safari too and
// blocks cross-site form posts.
export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: isProduction,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};
