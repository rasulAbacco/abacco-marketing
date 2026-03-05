//  server/src/routes/inbox/inbox.js - FIXED VERSION
import express from "express";
import prisma from "../../prismaClient.js";
import { protect } from "../../middlewares/authMiddleware.js";
import { runSyncForAccount } from "../../services/imap.service.js";
import cache from "../../utils/cache.js";


function extractNameOrEmail(value) {
  if (!value) return "Unknown";

  const match = value.match(/(.*)<(.+)>/);

  if (match) {
    const name = match[1].replace(/['"]/g, "").trim();
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
   HELPER: Build formatted messages from DB
========================================================= */
function formatMessages(messages) {
  return messages.map((m) => {

    const cleanBody = (m.body || "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")   // remove style blocks
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "") // remove scripts
      .replace(/<[^>]+>/g, " ")                         // remove HTML tags
      .replace(/&nbsp;/g, " ")
      .replace(/&zwnj;/g, "")
      .replace(/\s+/g, " ")
      .trim();

    return {
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

      lastBody: cleanBody.slice(0, 100),

      unreadCount: m.isRead ? 0 : 1,
      messageCount: 1,
      isStarred: m.isStarred,
    };
  });
}

/* =========================================================
   GET CONVERSATIONS
   GET /api/inbox/conversations/:accountId

   FIX: When cache hits, run sync in background AND invalidate
   cache after sync so the NEXT fetch gets fresh data.
   On cache miss, await sync before responding.
========================================================= */
router.get("/conversations/:accountId", protect, async (req, res) => {
  try {
    const accountId = Number(req.params.accountId);
    const { folder = "inbox" } = req.query;

    const cacheKey = `inbox:${req.user.id}:${accountId}:${folder}`;
    const cached = cache.get(cacheKey);

    if (cached) {
      // ✅ FIX 1: Trigger background sync AND invalidate cache after it
      // completes, so the very next poll gets fresh data immediately.
      prisma.emailAccount.findUnique({ where: { id: accountId } }).then(account => {
        if (!account) return;
        runSyncForAccount(prisma, account.email)
          .then(() => {
            // Invalidate so next request hits DB fresh
            cache.del(cacheKey);
            console.log(`🔄 Background sync done — cache invalidated for ${cacheKey}`);
          })
          .catch(() => {});
      });

      return res.json({ success: true, data: cached });
    }

    // Cache miss: await sync so response is always up-to-date
    const account = await prisma.emailAccount.findUnique({ where: { id: accountId } });
    if (account) {
      await runSyncForAccount(prisma, account.email);
    }

    let whereCondition = {
      emailAccountId: accountId,
    };

    if (folder === "inbox") {
      whereCondition = { ...whereCondition, folder: "inbox", direction: "received" };
    } else if (folder === "sent") {
      whereCondition = { ...whereCondition, folder: "sent", direction: "sent" };
    } else if (folder === "spam") {
      whereCondition = { ...whereCondition, folder: "spam" };
    } else if (folder === "trash") {
      whereCondition = { ...whereCondition, folder: "trash" };
    } else if (folder === "draft") {
      whereCondition = { ...whereCondition, folder: "draft" };
    }

    const messages = await prisma.emailMessage.findMany({
      where: whereCondition,
      orderBy: { sentAt: "desc" },
      include: { conversation: true },
    });

    const formatted = formatMessages(messages);

    // ✅ FIX 2: Shorter cache TTL (15s) so new emails appear faster
    cache.set(cacheKey, formatted, 15);

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
   BATCH MARK AS READ
   PATCH /api/inbox/batch-mark-read
========================================================= */
router.patch("/batch-mark-read", protect, async (req, res) => {
  try {
    const { conversationIds, accountId } = req.body;

    if (!conversationIds || !Array.isArray(conversationIds) || conversationIds.length === 0) {
      return res.status(400).json({ success: false, message: "conversationIds array is required" });
    }

    const result = await prisma.emailMessage.updateMany({
      where: {
        conversationId: { in: conversationIds },
        emailAccountId: Number(accountId),
      },
      data: { isRead: true },
    });

    try {
      const userId = req.user.id;
      ["inbox", "sent", "spam", "trash", "draft"].forEach(f =>
        cache.del(`inbox:${userId}:${accountId}:${f}`)
      );
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
   BATCH MARK AS UNREAD
   PATCH /api/inbox/batch-mark-unread
========================================================= */
router.patch("/batch-mark-unread", protect, async (req, res) => {
  try {
    const { conversationIds, accountId } = req.body;

    if (!conversationIds || !Array.isArray(conversationIds) || conversationIds.length === 0) {
      return res.status(400).json({ success: false, message: "conversationIds array is required" });
    }

    const result = await prisma.emailMessage.updateMany({
      where: {
        conversationId: { in: conversationIds },
        emailAccountId: Number(accountId),
      },
      data: { isRead: false },
    });

    try {
      const userId = req.user.id;
      ["inbox", "sent", "spam", "trash", "draft"].forEach(f =>
        cache.del(`inbox:${userId}:${accountId}:${f}`)
      );
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
   BATCH HIDE CONVERSATIONS (MOVE TO TRASH)
   PATCH /api/inbox/batch-hide-conversations
========================================================= */
router.patch("/batch-hide-conversations", protect, async (req, res) => {
  try {
    const { conversationIds, accountId } = req.body;

    if (!conversationIds || !Array.isArray(conversationIds) || conversationIds.length === 0) {
      return res.status(400).json({ success: false, message: "conversationIds array is required" });
    }

    const result = await prisma.emailMessage.updateMany({
      where: {
        conversationId: { in: conversationIds },
        emailAccountId: Number(accountId),
      },
      data: { folder: "trash" },
    });

    try {
      const userId = req.user.id;
      ["inbox", "sent", "spam", "trash", "draft"].forEach(f =>
        cache.del(`inbox:${userId}:${accountId}:${f}`)
      );
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
   SAVE MESSAGE TO DRAFT
   POST /api/inbox/save-draft
========================================================= */
router.post("/save-draft", protect, async (req, res) => {
  try {
    const { to, cc, subject, body, emailAccountId, conversationId, messageId } = req.body;

    if (!emailAccountId) {
      return res.status(400).json({ success: false, message: "emailAccountId is required" });
    }

    const account = await prisma.emailAccount.findUnique({
      where: { id: Number(emailAccountId) },
    });

    if (!account) {
      return res.status(404).json({ success: false, message: "Account not found" });
    }

    if (messageId) {
      const updated = await prisma.emailMessage.update({
        where: { id: messageId },
        data: {
          toEmail: to || "",
          ccEmail: cc || "",
          subject: subject || "(No subject)",
          body: body || "",
          sentAt: new Date(),
        },
      });

      try {
        cache.del(`inbox:${req.user.id}:${emailAccountId}:draft`);
      } catch (e) {}

      return res.json({ success: true, data: updated });
    }

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

    try {
      cache.del(`inbox:${req.user.id}:${emailAccountId}:draft`);
    } catch (e) {}

    res.json({ success: true, data: draft });
  } catch (err) {
    console.error("❌ Save draft error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/* =========================================================
   DELETE DRAFT
   DELETE /api/inbox/delete-draft/:messageId
========================================================= */
router.delete("/delete-draft/:messageId", protect, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { accountId } = req.body;

    await prisma.emailMessage.delete({ where: { id: messageId } });

    try {
      cache.del(`inbox:${req.user.id}:${accountId}:draft`);
    } catch (e) {}

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
    const countries = ["India", "USA", "UK", "Canada"];
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
      where: { conversationId, emailAccountId: Number(accountId) },
      data: { folder: "trash" },
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
      where: { conversationId, emailAccountId: Number(accountId) },
      data: { folder: "inbox" },
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
      where: { conversationId, emailAccountId: Number(accountId) },
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Permanent delete error:", err);
    res.status(500).json({ success: false });
  }
});

router.patch("/move-to-draft", protect, async (req, res) => {
  try {
    const { conversationId, accountId } = req.body;

    if (!conversationId || !accountId) {
      return res.status(400).json({ success: false, message: "Missing conversationId or accountId" });
    }

    const result = await prisma.emailMessage.updateMany({
      where: { conversationId, emailAccountId: Number(accountId) },
      data: { folder: "draft" },
    });

    try {
      const userId = req.user.id;
      ["inbox", "sent", "spam", "trash", "draft"].forEach(f =>
        cache.del(`inbox:${userId}:${accountId}:${f}`)
      );
    } catch (e) {}

    res.json({ success: true, moved: result.count });
  } catch (err) {
    console.error("❌ Move to draft error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;