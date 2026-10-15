import { Router } from "express";
import { sharedSite, getSharedSite, getSharedStats } from "../controllers/share.controller.js";

const router = Router();

router.get("/:token", sharedSite, getSharedSite);
router.get("/:token/stats", sharedSite, getSharedStats);

export default router;
