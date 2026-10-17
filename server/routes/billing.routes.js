import { Router } from "express";
import { protect } from "../middlewares/auth.middleware.js";
import { getBilling, createCheckout, verifyCheckout } from "../controllers/billing.controller.js";

const router = Router();

router.use(protect);
router.get("/", getBilling);
router.post("/checkout", createCheckout);
router.post("/verify", verifyCheckout);

export default router;
