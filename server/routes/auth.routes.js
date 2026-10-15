import { Router } from "express";
import { register, login, me, logout, socketToken } from "../controllers/auth.controller.js";
import { protect } from "../middlewares/auth.middleware.js";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.get("/me", protect, me);
router.get("/socket-token", protect, socketToken);
router.post("/logout", logout);

export default router;
