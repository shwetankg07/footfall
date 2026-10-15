import bcrypt from "bcrypt";
import User from "../models/user.model.js";
import { filled, isEmail } from "../utils/validate.js";
import { generateToken, cookieOptions } from "../utils/generateToken.js";

const publicUser = (user) => ({ _id: user._id, name: user.name, email: user.email });

export const register = async (req, res) => {
  const { name, email, password } = req.body ?? {};

  if (!filled(name, email, password)) {
    return res.status(400).json({ message: "Name, email and password are required" });
  }

  if (!isEmail(email)) {
    return res.status(400).json({ message: "Enter a valid email address" });
  }

  if (password.length < 8) {
    return res.status(400).json({ message: "Password must be at least 8 characters" });
  }

  const taken = await User.exists({ email: email.toLowerCase().trim() });

  if (taken) {
    return res.status(409).json({ message: "An account with this email already exists" });
  }

  const user = await User.create({ name, email, password: await bcrypt.hash(password, 10) });

  res.cookie("token", generateToken(user._id), cookieOptions);
  res.status(201).json({ user: publicUser(user) });
};

export const login = async (req, res) => {
  const { email, password } = req.body ?? {};

  if (!filled(email, password)) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  const user = await User.findOne({ email: email.toLowerCase().trim() });
  const passwordOk = user ? await bcrypt.compare(password, user.password) : false;

  if (!passwordOk) {
    return res.status(401).json({ message: "Wrong email or password" });
  }

  res.cookie("token", generateToken(user._id), cookieOptions);
  res.json({ user: publicUser(user) });
};

export const me = (req, res) => {
  res.json({ user: publicUser(req.user) });
};

export const logout = (req, res) => {
  res.clearCookie("token", { ...cookieOptions, maxAge: undefined });
  res.json({ message: "Logged out" });
};
