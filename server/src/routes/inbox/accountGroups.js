/**
 * routes/accountGroups.js
 *
 * CRUD routes for EmailAccountGroup.
 * Mount in your main router as:
 *   app.use("/api/account-groups", accountGroupsRouter);
 */

import express from "express";
import { PrismaClient } from "@prisma/client";
import { protect } from "../../middlewares/authMiddleware.js";

const router = express.Router();
const prisma = new PrismaClient();

/* ─────────────────────────────────────────────────────────────
   GET /api/account-groups
   Returns all groups for the logged-in user.
───────────────────────────────────────────────────────────── */
router.get("/", protect, async (req, res) => {
  try {
    const groups = await prisma.emailAccountGroup.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: "asc" },
    });
    res.json({ success: true, data: groups });
  } catch (err) {
    console.error("GET /account-groups error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────
   POST /api/account-groups
   Body: { name, color? }
───────────────────────────────────────────────────────────── */
router.post("/", protect, async (req, res) => {
  try {
    const { name, color } = req.body;
    if (!name?.trim()) {
      return res.status(400).json({ success: false, error: "Group name is required" });
    }

    const group = await prisma.emailAccountGroup.create({
      data: {
        name: name.trim(),
        color: color || "#10b981",
        userId: req.user.id,
      },
    });

    res.status(201).json({ success: true, data: group });
  } catch (err) {
    console.error("POST /account-groups error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────
   PATCH /api/account-groups/:id
   Body: { name?, color? }
───────────────────────────────────────────────────────────── */
router.patch("/:id", protect, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, color } = req.body;

    // Ensure ownership
    const existing = await prisma.emailAccountGroup.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!existing) {
      return res.status(404).json({ success: false, error: "Group not found" });
    }

    const updated = await prisma.emailAccountGroup.update({
      where: { id },
      data: {
        ...(name?.trim()  ? { name: name.trim() } : {}),
        ...(color         ? { color }              : {}),
      },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error("PATCH /account-groups/:id error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────
   DELETE /api/account-groups/:id
   Accounts in this group become ungrouped (groupId = null).
───────────────────────────────────────────────────────────── */
router.delete("/:id", protect, async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    const existing = await prisma.emailAccountGroup.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!existing) {
      return res.status(404).json({ success: false, error: "Group not found" });
    }

    // Unlink accounts so they are not deleted, just ungrouped
    await prisma.emailAccount.updateMany({
      where: { groupId: id },
      data: { groupId: null },
    });

    await prisma.emailAccountGroup.delete({ where: { id } });

    res.json({ success: true, message: "Group deleted, accounts moved to ungrouped" });
  } catch (err) {
    console.error("DELETE /account-groups/:id error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;