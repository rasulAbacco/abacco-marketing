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
   Deletes the group AND all accounts inside it, along with
   every related record (messages, attachments, conversations,
   tags, folders, sync states) for each account.
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

    // 1️⃣ Find all accounts in this group
    const accountsInGroup = await prisma.emailAccount.findMany({
      where: { groupId: id },
      select: { id: true },
    });
    const accountIds = accountsInGroup.map((a) => a.id);

    // 2️⃣ For each account, delete all related data (same order as DELETE /accounts/:id)
    if (accountIds.length > 0) {
      // ── Messages + their children ──────────────────────────────────
      const messages = await prisma.emailMessage.findMany({
        where: { emailAccountId: { in: accountIds } },
        select: { id: true },
      });
      const messageIds = messages.map((m) => m.id);

      if (messageIds.length > 0) {
        await prisma.attachment.deleteMany({
          where: { emailMessageId: { in: messageIds } },
        });
        await prisma.messageTag.deleteMany({
          where: { messageId: { in: messageIds } },
        });
      }

      await prisma.emailMessage.deleteMany({
        where: { emailAccountId: { in: accountIds } },
      });

      // ── Conversations + their children ─────────────────────────────
      const conversations = await prisma.conversation.findMany({
        where: { emailAccountId: { in: accountIds } },
        select: { id: true },
      });
      const conversationIds = conversations.map((c) => c.id);

      if (conversationIds.length > 0) {
        await prisma.conversationTag.deleteMany({
          where: { conversationId: { in: conversationIds } },
        });
        await prisma.scheduledMessage.deleteMany({
          where: { conversationId: { in: conversationIds } },
        });
      }

      await prisma.conversation.deleteMany({
        where: { emailAccountId: { in: accountIds } },
      });

      // ── Other per-account data ─────────────────────────────────────
      await prisma.emailFolder.deleteMany({
        where: { accountId: { in: accountIds } },
      });
      await prisma.syncState.deleteMany({
        where: { accountId: { in: accountIds } },
      });

      // 3️⃣ Delete the accounts themselves
      await prisma.emailAccount.deleteMany({
        where: { id: { in: accountIds } },
      });
    }

    // 4️⃣ Delete the group
    await prisma.emailAccountGroup.delete({ where: { id } });

    res.json({
      success: true,
      message: `Group deleted along with ${accountIds.length} account(s) and all their data.`,
      deletedAccountCount: accountIds.length,
    });
  } catch (err) {
    console.error("DELETE /account-groups/:id error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;