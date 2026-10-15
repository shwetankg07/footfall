import { Router } from "express";
import { protect } from "../middlewares/auth.middleware.js";
import { listAlerts, markRead, markAllRead } from "../controllers/alert.controller.js";

const router = Router();

router.use(protect);
router.get("/", listAlerts);
router.post("/read-all", markAllRead);
router.post("/:alertId/read", markRead);

export default router;
