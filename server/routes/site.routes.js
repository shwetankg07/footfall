import { Router } from "express";
import { protect } from "../middlewares/auth.middleware.js";
import { siteAccess } from "../middlewares/site.middleware.js";
import { getStats, getForecast } from "../controllers/stats.controller.js";
import { listFunnels, createFunnel, deleteFunnel, getFunnelResult } from "../controllers/funnel.controller.js";
import { listSites, createSite, getSite, updateSite, deleteSite } from "../controllers/site.controller.js";

const router = Router();

router.use(protect);
router.get("/", listSites);
router.post("/", createSite);
router.get("/:siteId", siteAccess("viewer"), getSite);
router.get("/:siteId/stats", siteAccess("viewer"), getStats);
router.get("/:siteId/forecast", siteAccess("viewer"), getForecast);
router.get("/:siteId/funnels", siteAccess("viewer"), listFunnels);
router.post("/:siteId/funnels", siteAccess("admin"), createFunnel);
router.get("/:siteId/funnels/:funnelId", siteAccess("viewer"), getFunnelResult);
router.delete("/:siteId/funnels/:funnelId", siteAccess("admin"), deleteFunnel);
router.patch("/:siteId", siteAccess("admin"), updateSite);
router.delete("/:siteId", siteAccess("owner"), deleteSite);

export default router;
