//  server/src/routes/inbox/inbox.js - WITH DRAFT SUPPORT
import express from "express";
import prisma from "../../prismaClient.js";
import { protect } from "../../middlewares/authMiddleware.js";
import { runSyncForAccount } from "../../services/imap.service.js";
import cache from "../../utils/cache.js";


function extractNameOrEmail(value) {
  if (!value) return "Unknown";

  const match = value.match(/(.*)<(.+)>/);

  if (match) {
    const name = match[1].replace(/["']/g, "").trim();
    const email = match[2].trim();
    return name || email;
  }

  return value.trim();
}

const router = express.Router();

/* =========================================================
   GET UNREAD COUNT
   GET /api/inbox/accounts/:id/unread
========================================================= */
router.get("/accounts/:id/unread", protect, async (req, res) => {
  try {
    const accountId = Number(req.params.id);

    const count = await prisma.emailMessage.count({
      where: {
        emailAccountId: accountId,
        direction: "received",
        isRead: false,
      },
    });

    res.json({
      success: true,
      data: { inboxUnread: count },
    });
  } catch (err) {
    console.error("Unread error:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================================================
   GET CONVERSATIONS
   GET /api/inbox/conversations/:accountId
========================================================= */
router.get("/conversations/:accountId", protect, async (req, res) => {
  try {
    const accountId = Number(req.params.accountId);
    const { folder = "inbox" } = req.query;

    const cacheKey = `inbox:${req.user.id}:${accountId}:${folder}`;
    
    const account = await prisma.emailAccount.findUnique({
      where: { id: accountId },
    });

    // ✅ ALWAYS sync first (important!)
    if (account) {
      runSyncForAccount(prisma, account.email)
        .catch(err => console.error(err));
    }

    let whereCondition = {
      emailAccountId: accountId,
    };

    // 🔹 Folder-based filtering
    if (folder === "inbox") {
      whereCondition = {
        ...whereCondition,
        folder: "inbox",
        direction: "received",
      };
    }

    if (folder === "sent") {
      whereCondition = {
        ...whereCondition,
        folder: "sent",
        direction: "sent",
      };
    }

    if (folder === "spam") {
      whereCondition = {
        ...whereCondition,
        folder: "spam",
      };
    }

    if (folder === "trash") {
      whereCondition = {
        ...whereCondition,
        folder: "trash",
      };
    }

    // ✅ NEW: Draft folder
    if (folder === "draft") {
      whereCondition = {
        ...whereCondition,
        folder: "draft",
      };
    }

    const messages = await prisma.emailMessage.findMany({
      where: whereCondition,
      orderBy: { sentAt: "desc" },
      include: {
        conversation: true,
      },
    });

    const formatted = messages.map((m) => ({
      conversationId: m.conversationId,
      subject: m.subject || "(No subject)",

      displayName:
        m.direction === "sent"
          ? extractNameOrEmail(m.toEmail?.split(",")[0])
          : extractNameOrEmail(m.fromName || m.fromEmail),

      displayEmail:
        m.direction === "sent"
          ? m.toEmail?.split(",")[0]
          : m.fromEmail,

      initiatorEmail: m.fromEmail,
      lastSenderEmail: m.fromEmail,
      lastDate: m.sentAt,
      lastBody: m.body?.replace(/<[^>]*>/g, "").slice(0, 100) || "",
      unreadCount: m.isRead ? 0 : 1,
      messageCount: 1,
      isStarred: m.isStarred,
    }));

    // ✅ Store in cache (30 seconds like inbox behavior)
    cache.set(cacheKey, formatted, 30);

    return res.json({ success: true, data: formatted });
  } catch (err) {
    console.error("Conversations error:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================================================
   GET MESSAGES OF CONVERSATION
   GET /api/inbox/conversations/:conversationId/messages
========================================================= */
router.get(
  "/conversations/:conversationId/messages",
  protect,
  async (req, res) => {
    try {
      const { conversationId } = req.params;

      const messages = await prisma.emailMessage.findMany({
        where: { conversationId },
        orderBy: { sentAt: "asc" },
      });

      res.json({ success: true, data: messages });
    } catch (err) {
      console.error("Messages error:", err);
      res.status(500).json({ success: false });
    }
  }
);

/* =========================================================
   MARK CONVERSATION AS READ
   PATCH /api/inbox/conversations/:conversationId/read
========================================================= */
router.patch("/conversations/:conversationId/read", protect, async (req, res) => {
    try {
      const { conversationId } = req.params;

      await prisma.emailMessage.updateMany({
        where: { conversationId },
        data: { isRead: true },
      });

      res.json({ success: true });
    } catch (err) {
      console.error("Mark read error:", err);
      res.status(500).json({ success: false });
    }
  }
);

/* =========================================================
   MARK CONVERSATION AS UNREAD
   PATCH /api/inbox/conversations/:conversationId/unread
========================================================= */
router.patch("/conversations/:conversationId/unread", protect, async (req, res) => {
    try {
      const { conversationId } = req.params;

      await prisma.emailMessage.updateMany({
        where: { conversationId },
        data: { isRead: false },
      });

      res.json({ success: true });
    } catch (err) {
      console.error("Mark unread error:", err);
      res.status(500).json({ success: false });
    }
  }
);

/* =========================================================
   ✅ NEW: BATCH MARK AS READ
   PATCH /api/inbox/batch-mark-read
========================================================= */
router.patch("/batch-mark-read", protect, async (req, res) => {
  try {
    const { conversationIds, accountId } = req.body;

    if (!conversationIds || !Array.isArray(conversationIds) || conversationIds.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: "conversationIds array is required" 
      });
    }

    console.log(`✅ Batch marking ${conversationIds.length} conversations as read`);

    // Update all messages in these conversations
    const result = await prisma.emailMessage.updateMany({
      where: {
        conversationId: { in: conversationIds },
        emailAccountId: Number(accountId),
      },
      data: { isRead: true },
    });

    console.log(`✅ Marked ${result.count} messages as read`);

    // Clear cache for this account
    try {
      const userId = req.user.id;
      cache.del(`inbox:${userId}:${accountId}:inbox`);
      cache.del(`inbox:${userId}:${accountId}:sent`);
      cache.del(`inbox:${userId}:${accountId}:spam`);
      cache.del(`inbox:${userId}:${accountId}:trash`);
      cache.del(`inbox:${userId}:${accountId}:draft`);
    } catch (e) {
      console.warn("Cache clear failed:", e.message);
    }

    res.json({ success: true, updated: result.count });
  } catch (err) {
    console.error("❌ Batch mark read error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/* =========================================================
   ✅ NEW: BATCH MARK AS UNREAD
   PATCH /api/inbox/batch-mark-unread
========================================================= */
router.patch("/batch-mark-unread", protect, async (req, res) => {
  try {
    const { conversationIds, accountId } = req.body;

    if (!conversationIds || !Array.isArray(conversationIds) || conversationIds.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: "conversationIds array is required" 
      });
    }

    console.log(`✅ Batch marking ${conversationIds.length} conversations as unread`);

    // Update all messages in these conversations
    const result = await prisma.emailMessage.updateMany({
      where: {
        conversationId: { in: conversationIds },
        emailAccountId: Number(accountId),
      },
      data: { isRead: false },
    });

    console.log(`✅ Marked ${result.count} messages as unread`);

    // Clear cache for this account
    try {
      const userId = req.user.id;
      cache.del(`inbox:${userId}:${accountId}:inbox`);
      cache.del(`inbox:${userId}:${accountId}:sent`);
      cache.del(`inbox:${userId}:${accountId}:spam`);
      cache.del(`inbox:${userId}:${accountId}:trash`);
      cache.del(`inbox:${userId}:${accountId}:draft`);
    } catch (e) {
      console.warn("Cache clear failed:", e.message);
    }

    res.json({ success: true, updated: result.count });
  } catch (err) {
    console.error("❌ Batch mark unread error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/* =========================================================
   ✅ NEW: BATCH HIDE CONVERSATIONS (MOVE TO TRASH)
   PATCH /api/inbox/batch-hide-conversations
========================================================= */
router.patch("/batch-hide-conversations", protect, async (req, res) => {
  try {
    const { conversationIds, accountId } = req.body;

    if (!conversationIds || !Array.isArray(conversationIds) || conversationIds.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: "conversationIds array is required" 
      });
    }

    console.log(`✅ Batch hiding ${conversationIds.length} conversations`);

    // Move all messages in these conversations to trash
    const result = await prisma.emailMessage.updateMany({
      where: {
        conversationId: { in: conversationIds },
        emailAccountId: Number(accountId),
      },
      data: { folder: "trash" },
    });

    console.log(`✅ Moved ${result.count} messages to trash`);

    // Clear cache for this account
    try {
      const userId = req.user.id;
      cache.del(`inbox:${userId}:${accountId}:inbox`);
      cache.del(`inbox:${userId}:${accountId}:sent`);
      cache.del(`inbox:${userId}:${accountId}:spam`);
      cache.del(`inbox:${userId}:${accountId}:trash`);
      cache.del(`inbox:${userId}:${accountId}:draft`);
    } catch (e) {
      console.warn("Cache clear failed:", e.message);
    }

    res.json({ success: true, updated: result.count });
  } catch (err) {
    console.error("❌ Batch hide error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/* =========================================================
   ✅ NEW: SAVE MESSAGE TO DRAFT
   POST /api/inbox/save-draft
========================================================= */
router.post("/save-draft", protect, async (req, res) => {
  try {
    const {
      to,
      cc,
      subject,
      body,
      emailAccountId,
      conversationId,
      messageId, // If updating existing draft
    } = req.body;

    if (!emailAccountId) {
      return res.status(400).json({
        success: false,
        message: "emailAccountId is required",
      });
    }

    const account = await prisma.emailAccount.findUnique({
      where: { id: Number(emailAccountId) },
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    // If messageId provided, update existing draft
    if (messageId) {
      const updated = await prisma.emailMessage.update({
        where: { id: messageId },
        data: {
          toEmail: to || "",
          ccEmail: cc || "",
          subject: subject || "(No subject)",
          body: body || "",
          sentAt: new Date(), // Update timestamp
        },
      });

      // Clear cache
      try {
        const userId = req.user.id;
        cache.del(`inbox:${userId}:${emailAccountId}:draft`);
      } catch (e) {
        console.warn("Cache clear failed:", e.message);
      }

      return res.json({ success: true, data: updated });
    }

    // Create new draft
    const draft = await prisma.emailMessage.create({
      data: {
        emailAccountId: Number(emailAccountId),
        conversationId: conversationId || null,
        messageId: `draft-${Date.now()}@${account.email}`,
        fromEmail: account.email,
        fromName: account.senderName || null,
        toEmail: to || "",
        ccEmail: cc || "",
        subject: subject || "(No subject)",
        body: body || "",
        direction: "sent",
        sentAt: new Date(),
        folder: "draft",
        isRead: true,
      },
    });

    // Clear cache
    try {
      const userId = req.user.id;
      cache.del(`inbox:${userId}:${emailAccountId}:draft`);
    } catch (e) {
      console.warn("Cache clear failed:", e.message);
    }

    res.json({ success: true, data: draft });
  } catch (err) {
    console.error("❌ Save draft error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/* =========================================================
   ✅ NEW: DELETE DRAFT
   DELETE /api/inbox/delete-draft/:messageId
========================================================= */
router.delete("/delete-draft/:messageId", protect, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { accountId } = req.body;

    await prisma.emailMessage.delete({
      where: { id: messageId },
    });

    // Clear cache
    try {
      const userId = req.user.id;
      cache.del(`inbox:${userId}:${accountId}:draft`);
    } catch (e) {
      console.warn("Cache clear failed:", e.message);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Delete draft error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/* =========================================================
   SEARCH
   GET /api/inbox/search?query=&accountId=
========================================================= */
router.get("/search", protect, async (req, res) => {
  try {
    const { query, accountId } = req.query;

    if (!query || !accountId) {
      return res.json({ success: true, data: [] });
    }

    const results = await prisma.emailMessage.findMany({
      where: {
        emailAccountId: Number(accountId),
        OR: [
          { subject: { contains: query, mode: "insensitive" } },
          { fromEmail: { contains: query, mode: "insensitive" } },
          { toEmail: { contains: query, mode: "insensitive" } },
        ],
      },
      orderBy: { sentAt: "desc" },
    });

    res.json({ success: true, data: results });
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ success: false });
  }
});


router.get("/countries", async (req, res) => {
  try {
    const countries = ["India", "USA", "UK", "Canada"]; // or from DB
    res.json({ success: true, data: countries });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch countries" });
  }
});

router.get("/accounts/:id/user", protect, async (req, res) => {
  try {
    const id = Number(req.params.id);

    const account = await prisma.emailAccount.findUnique({
      where: { id },
      select: { email: true },
    });

    if (!account) {
      return res.status(404).json({ success: false });
    }

    res.json({
      success: true,
      userName: account.email.split("@")[0],
    });
  } catch (err) {
    console.error("User fetch error:", err);
    res.status(500).json({ success: false });
  }
});

router.patch("/hide-inbox-conversation", protect, async (req, res) => {
  try {
    const { conversationId, accountId } = req.body;

    if (!conversationId || !accountId) {
      return res.status(400).json({ success: false, message: "Missing data" });
    }

    await prisma.emailMessage.updateMany({
      where: {
        conversationId,
        emailAccountId: Number(accountId),
      },
      data: {
        folder: "trash",
      },
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Trash move error:", err);
    res.status(500).json({ success: false });
  }
});

router.patch("/restore-conversation", protect, async (req, res) => {
  try {
    const { conversationId, accountId } = req.body;

    await prisma.emailMessage.updateMany({
      where: {
        conversationId,
        emailAccountId: Number(accountId),
      },
      data: {
        folder: "inbox",
      },
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Restore error:", err);
    res.status(500).json({ success: false });
  }
});

router.delete("/permanent-delete-conversation", protect, async (req, res) => {
  try {
    const { conversationId, accountId } = req.body;

    await prisma.emailMessage.deleteMany({
      where: {
        conversationId,
        emailAccountId: Number(accountId),
      },
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Permanent delete error:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================================================
   ✅ NEW: MOVE CONVERSATION TO DRAFT FOLDER
   PATCH /api/inbox/move-to-draft
========================================================= */
router.patch("/move-to-draft", protect, async (req, res) => {
  try {
    const { conversationId, accountId } = req.body;

    if (!conversationId || !accountId) {
      return res.status(400).json({ 
        success: false, 
        message: "Missing conversationId or accountId" 
      });
    }

    console.log(`📁 Moving conversation ${conversationId} to draft folder`);

    // Move all messages in this conversation to draft folder
    const result = await prisma.emailMessage.updateMany({
      where: {
        conversationId,
        emailAccountId: Number(accountId),
      },
      data: {
        folder: "draft",
      },
    });

    console.log(`✅ Moved ${result.count} messages to draft`);

    // Clear cache
    try {
      const userId = req.user.id;
      cache.del(`inbox:${userId}:${accountId}:inbox`);
      cache.del(`inbox:${userId}:${accountId}:sent`);
      cache.del(`inbox:${userId}:${accountId}:spam`);
      cache.del(`inbox:${userId}:${accountId}:trash`);
      cache.del(`inbox:${userId}:${accountId}:draft`);
    } catch (e) {
      console.warn("Cache clear failed:", e.message);
    }

    res.json({ success: true, moved: result.count });
  } catch (err) {
    console.error("❌ Move to draft error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;