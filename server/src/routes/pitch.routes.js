import express from "express";
import {
  createPitch,
  getPitches,
  updatePitch,
  deletePitch,
} from "../controllers/pitch.controller.js";

import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.use(protect);

router.post("/", createPitch);
router.get("/", getPitches);
router.put("/:id", updatePitch);
router.delete("/:id", deletePitch);

export default router;
