import { Router } from "express";
import { protect } from "../middlewares/auth.middleware.js";
import { previewInvite, acceptInvite, declineInvite } from "../controllers/team.controller.js";

const router = Router();

router.use(protect);
router.get("/:token", previewInvite);
router.post("/:token/accept", acceptInvite);
router.post("/:token/decline", declineInvite);

export default router;
