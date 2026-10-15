import jwt from "jsonwebtoken";
import User from "../models/user.model.js";

export const userFromToken = async (token) => {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return await User.findById(payload.id).select("-password");
  } catch {
    return null;
  }
};

export const protect = async (req, res, next) => {
  const user = await userFromToken(req.cookies.token);

  if (!user) {
    return res.status(401).json({ message: "Please log in first" });
  }

  req.user = user;
  next();
};
