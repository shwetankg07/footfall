import jwt from "jsonwebtoken";

export const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "7d" });
};

const isProduction = process.env.NODE_ENV === "production";

// The dashboard and the API live on different domains in production, so the
// cookie has to be SameSite=None, which browsers only accept with Secure.
export const cookieOptions = {
  httpOnly: true,
  sameSite: isProduction ? "none" : "lax",
  secure: isProduction,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};
