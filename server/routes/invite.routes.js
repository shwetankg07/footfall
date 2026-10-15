import { Router } from "express";
import { protect } from "../middlewares/auth.middleware.js";
import { myInvites, acceptInvite, declineInvite } from "../controllers/team.controller.js";

const router = Router();

router.use(protect);
router.get("/", myInvites);
router.post("/:inviteId/accept", acceptInvite);
router.post("/:inviteId/decline", declineInvite);

export default router;
