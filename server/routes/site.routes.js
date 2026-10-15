import { Router } from "express";
import { protect } from "../middlewares/auth.middleware.js";
import { siteAccess } from "../middlewares/site.middleware.js";
import { listSites, createSite, getSite, updateSite, deleteSite } from "../controllers/site.controller.js";

const router = Router();

router.use(protect);
router.get("/", listSites);
router.post("/", createSite);
router.get("/:siteId", siteAccess("viewer"), getSite);
router.patch("/:siteId", siteAccess("admin"), updateSite);
router.delete("/:siteId", siteAccess("owner"), deleteSite);

export default router;
