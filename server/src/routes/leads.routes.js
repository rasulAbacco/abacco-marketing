import express from "express";
import {
  createLeadFromInbox,
  getAllLeads,
  getLeadById,
  deleteLead,
  updateLead,
} from "../controllers/leads.controller.js";

const router = express.Router();

router.post("/create-from-inbox", createLeadFromInbox);
router.get("/", getAllLeads);
router.get("/:id", getLeadById);
router.delete("/:id", deleteLead);
router.put("/:id", updateLead);

export default router;
