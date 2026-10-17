import { Router } from "express";
import { protect } from "../middlewares/auth.middleware.js";
import { siteAccess, requireIntelligence } from "../middlewares/site.middleware.js";
import { getInsights, getFunnelDrivers } from "../controllers/insight.controller.js";
import { getStats, getForecast } from "../controllers/stats.controller.js";
import { listFunnels, createFunnel, deleteFunnel, getFunnelResult } from "../controllers/funnel.controller.js";
import { listMembers, inviteMember, cancelInvite, changeRole, removeMember } from "../controllers/team.controller.js";
import { enableShare, disableShare } from "../controllers/share.controller.js";
import { listSites, createSite, getSite, updateSite, deleteSite } from "../controllers/site.controller.js";

const router = Router();

router.use(protect);
router.get("/", listSites);
router.post("/", createSite);
router.get("/:siteId", siteAccess("viewer"), getSite);
router.get("/:siteId/stats", siteAccess("viewer"), getStats);
router.get("/:siteId/forecast", siteAccess("viewer"), requireIntelligence, getForecast);
router.get("/:siteId/insights", siteAccess("viewer"), requireIntelligence, getInsights);
router.get("/:siteId/funnels", siteAccess("viewer"), listFunnels);
router.post("/:siteId/funnels", siteAccess("admin"), createFunnel);
router.get("/:siteId/funnels/:funnelId", siteAccess("viewer"), getFunnelResult);
router.get("/:siteId/funnels/:funnelId/drivers", siteAccess("viewer"), requireIntelligence, getFunnelDrivers);
router.delete("/:siteId/funnels/:funnelId", siteAccess("admin"), deleteFunnel);
router.get("/:siteId/members", siteAccess("viewer"), listMembers);
router.patch("/:siteId/members/:userId", siteAccess("admin"), changeRole);
router.delete("/:siteId/members/:userId", siteAccess("viewer"), removeMember);
router.post("/:siteId/invites", siteAccess("admin"), inviteMember);
router.delete("/:siteId/invites/:inviteId", siteAccess("admin"), cancelInvite);
router.post("/:siteId/share", siteAccess("admin"), enableShare);
router.delete("/:siteId/share", siteAccess("admin"), disableShare);
router.patch("/:siteId", siteAccess("admin"), updateSite);
router.delete("/:siteId", siteAccess("owner"), deleteSite);

export default router;
