import express from "express";
import { protect } from "../middlewares/authMiddleware.js";
import {
  createCampaign,
  sendCampaignNow,
  scheduleCampaign,
  getAllCampaigns,
  createFollowupCampaign,
  getDashboardCampaigns,
  getCampaignProgress,
  getLockedAccounts,
  deleteCampaign,
  getCampaignsForFollowup
} from "../controllers/campaigns.controller.js";

const router = express.Router();

// Dashboard route should come BEFORE the generic "/" route
// to avoid route conflicts
router.get('/dashboard', protect, getDashboardCampaigns);

router.post("/", protect, createCampaign);
router.post("/:id/send", protect, sendCampaignNow);
router.post("/:id/schedule", protect, scheduleCampaign);
router.get("/", protect, getAllCampaigns);
router.post("/followup", protect, createFollowupCampaign);
router.get("/:id/progress", getCampaignProgress);
router.get("/accounts/locked", protect, getLockedAccounts);
router.delete("/:id", protect, deleteCampaign);
router.get("/campaigns/for-followup", getCampaignsForFollowup);

export default router;