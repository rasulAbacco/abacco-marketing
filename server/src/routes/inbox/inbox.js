// server/src/routes/inbox/inbox.js
import express from "express";
import prisma from "../../prismaClient.js";
import { protect } from "../../middlewares/authMiddleware.js";
import { runSyncForAccount } from "../../services/imap.service.js";
import cache from "../../utils/cache.js";

// ─────────────────────────────────────────────
// PRISMA SCHEMA NOTE
// Add this index to your EmailMessage model for
// faster sentAt-range queries per account:
//
//   @@index([emailAccountId, sentAt])
// ─────────────────────────────────────────────

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
   HELPER: Resolve monthFilter → startDate
   Supported values: "current" | "last" | "three"
   Default (unknown / missing): "current"
========================================================= */
function resolveStartDate(monthFilter) {
  const now = new Date();

  if (monthFilter === "last") {
    // First day of the previous calendar month
    return new Date(now.getFullYear(), now.getMonth() - 1, 1);
  }

  if (monthFilter === "three") {
    // First day of the month that was 3 months ago
    return new Date(now.getFullYear(), now.getMonth() - 3, 1);
  }

  // Default: "current" → first day of the current month
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/* =========================================================
   HELPER: Build ALL cache keys for an account+folder
   (one per monthFilter value) so bulk-invalidation is easy.
========================================================= */
const MONTH_FILTERS = ["current", "last", "three"];

function allCacheKeys(userId, accountId, folder) {
  return MONTH_FILTERS.map(
    (mf) => `inbox:${userId}:${accountId}:${folder}:${mf}`
  );
}

function clearAllFolderCaches(userId, accountId) {
  ["inbox", "sent", "spam", "trash", "draft"].forEach((folder) => {
    allCacheKeys(userId, accountId, folder).forEach((key) => cache.del(key));
  });
}

/* =========================================================
   GET UNREAD COUNT
   GET /api/inbox/accounts/:id/unread
========================================================= */
router.get("/accounts/:id/unread", protect, async (req, res) => {
  try {
    const accountId = Number(req.params.id);

    // Count only unread messages in the inbox folder (not spam/trash/sent)
    // This ensures the sidebar badge reflects true inbox unread count only
    const count = await prisma.emailMessage.count({
      where: {
        emailAccountId: accountId,
        direction: "received",
        isRead: false,
        folder: "inbox",
      },
    });

    res.json({ success: true, data: { inboxUnread: count } });
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
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
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
        m.direction === "sent" ? m.toEmail?.split(",")[0] : m.fromEmail,

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
       ?folder=inbox
       &monthFilter=current|last|three   ← NEW

   monthFilter defaults to "current" when omitted.

   Results are capped at 200, sorted by sentAt DESC.
   Cache key now includes monthFilter so each bucket is
   stored and invalidated independently.
========================================================= */
router.get("/conversations/:accountId", protect, async (req, res) => {
  try {
    const accountId = Number(req.params.accountId);
    const { folder = "inbox", monthFilter = "current" } = req.query;

    // Normalise to a known value to prevent cache-key injection
    const safeFilter = MONTH_FILTERS.includes(monthFilter)
      ? monthFilter
      : "current";

    const cacheKey = `inbox:${req.user.id}:${accountId}:${folder}:${safeFilter}`;
    const cached = cache.get(cacheKey);

    // ── Always return cached data instantly if available ──────
    if (cached) {
      // Kick off background sync → invalidate cache when done
      // so the NEXT poll gets fresh data without blocking this one
      prisma.emailAccount
        .findUnique({ where: { id: accountId } })
        .then((account) => {
          if (!account) return;
          runSyncForAccount(prisma, account.email)
            .then(() => {
              cache.del(cacheKey);
              console.log(`🔄 Background sync done — cache cleared: ${cacheKey}`);
            })
            .catch(() => {});
        });

      return res.json({ success: true, data: cached });
    }

    // ── Cache miss: query DB FIRST, respond immediately ────────
    // IMAP sync runs in background — never block the response on it.
    const account = await prisma.emailAccount.findUnique({
      where: { id: accountId },
    });
    if (account) {
      // Fire-and-forget — do NOT await
      runSyncForAccount(prisma, account.email)
        .then(() => {
          // Invalidate after sync so the next request picks up new mail
          cache.del(cacheKey);
          console.log(`🔄 Background sync done — cache cleared: ${cacheKey}`);
        })
        .catch(() => {});
    }

    // ── Build where condition ────────────────────────────────
    const startDate = resolveStartDate(safeFilter);

    let whereCondition = {
      emailAccountId: accountId,
      sentAt: { gte: startDate }, // ← month-based date filter
    };

    if (folder === "inbox") {
      whereCondition = {
        ...whereCondition,
        folder: "inbox",
        direction: "received",
      };
    } else if (folder === "sent") {
      whereCondition = {
        ...whereCondition,
        folder: "sent",
        direction: "sent",
      };
    } else if (folder === "spam") {
      whereCondition = { ...whereCondition, folder: "spam" };
    } else if (folder === "trash") {
      whereCondition = { ...whereCondition, folder: "trash" };
    } else if (folder === "draft") {
      whereCondition = { ...whereCondition, folder: "draft" };
    }

    // ── Query: max 200 results, newest first ─────────────────
    const messages = await prisma.emailMessage.findMany({
      where: whereCondition,
      orderBy: { sentAt: "desc" },
      take: 200,
      include: { conversation: true },
    });

    const formatted = formatMessages(messages);

    // ── Deduplicate by conversationId ────────────────────────
    // The query returns one row per *message*, not per conversation.
    // Multiple messages in the same thread share a conversationId,
    // which causes React "duplicate key" errors in the inbox list.
    // Since results are already sorted sentAt DESC, the first
    // occurrence of each conversationId is the most recent — keep it.
    const seen = new Set();
    const deduplicated = formatted.filter((item) => {
      if (!item.conversationId || seen.has(item.conversationId)) return false;
      seen.add(item.conversationId);
      return true;
    });

    // Short TTL (15 s) so new emails appear quickly
    cache.set(cacheKey, deduplicated, 15);

    return res.json({ success: true, data: deduplicated });
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
router.patch(
  "/conversations/:conversationId/read",
  protect,
  async (req, res) => {
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
router.patch(
  "/conversations/:conversationId/unread",
  protect,
  async (req, res) => {
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

    if (
      !conversationIds ||
      !Array.isArray(conversationIds) ||
      conversationIds.length === 0
    ) {
      return res
        .status(400)
        .json({ success: false, message: "conversationIds array is required" });
    }

    const result = await prisma.emailMessage.updateMany({
      where: {
        conversationId: { in: conversationIds },
        emailAccountId: Number(accountId),
      },
      data: { isRead: true },
    });

    try {
      clearAllFolderCaches(req.user.id, accountId);
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

    if (
      !conversationIds ||
      !Array.isArray(conversationIds) ||
      conversationIds.length === 0
    ) {
      return res
        .status(400)
        .json({ success: false, message: "conversationIds array is required" });
    }

    const result = await prisma.emailMessage.updateMany({
      where: {
        conversationId: { in: conversationIds },
        emailAccountId: Number(accountId),
      },
      data: { isRead: false },
    });

    try {
      clearAllFolderCaches(req.user.id, accountId);
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

    if (
      !conversationIds ||
      !Array.isArray(conversationIds) ||
      conversationIds.length === 0
    ) {
      return res
        .status(400)
        .json({ success: false, message: "conversationIds array is required" });
    }

    const result = await prisma.emailMessage.updateMany({
      where: {
        conversationId: { in: conversationIds },
        emailAccountId: Number(accountId),
      },
      data: { folder: "trash" },
    });

    try {
      clearAllFolderCaches(req.user.id, accountId);
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
    const {
      to,
      cc,
      subject,
      body,
      emailAccountId,
      conversationId,
      messageId,
    } = req.body;

    if (!emailAccountId) {
      return res
        .status(400)
        .json({ success: false, message: "emailAccountId is required" });
    }

    const account = await prisma.emailAccount.findUnique({
      where: { id: Number(emailAccountId) },
    });

    if (!account) {
      return res
        .status(404)
        .json({ success: false, message: "Account not found" });
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
        allCacheKeys(req.user.id, emailAccountId, "draft").forEach((k) =>
          cache.del(k)
        );
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
      allCacheKeys(req.user.id, emailAccountId, "draft").forEach((k) =>
        cache.del(k)
      );
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
      allCacheKeys(req.user.id, accountId, "draft").forEach((k) =>
        cache.del(k)
      );
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
      take: 200,
    });

    res.json({ success: true, data: results });
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ success: false });
  }
});

router.get("/countries", async (_req, res) => {
  try {
    res.json({ success: true, data: ["India", "USA", "UK", "Canada"] });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch countries" });
  }
});

router.get("/accounts/:id/user", protect, async (req, res) => {
  try {
    const id = Number(req.params.id);

    const account = await prisma.emailAccount.findUnique({
      where: { id },
      select: { email: true },
    });

    if (!account) return res.status(404).json({ success: false });

    res.json({ success: true, userName: account.email.split("@")[0] });
  } catch (err) {
    console.error("User fetch error:", err);
    res.status(500).json({ success: false });
  }
});

router.patch("/hide-inbox-conversation", protect, async (req, res) => {
  try {
    const { conversationId, accountId } = req.body;

    if (!conversationId || !accountId) {
      return res
        .status(400)
        .json({ success: false, message: "Missing data" });
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
      return res
        .status(400)
        .json({
          success: false,
          message: "Missing conversationId or accountId",
        });
    }

    const result = await prisma.emailMessage.updateMany({
      where: { conversationId, emailAccountId: Number(accountId) },
      data: { folder: "draft" },
    });

    try {
      clearAllFolderCaches(req.user.id, accountId);
    } catch (e) {}

    res.json({ success: true, moved: result.count });
  } catch (err) {
    console.error("❌ Move to draft error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;