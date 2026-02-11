// server/routes/inbox.js - ENHANCED VERSION
import express from "express";
import { randomBytes } from "crypto";
import { Buffer } from "buffer";
import qp from "quoted-printable";
import sgMail from "@sendgrid/mail";
import fetch from "node-fetch";
import { ImapFlow } from "imapflow";
import { htmlToText } from "html-to-text";
import crypto from "crypto";
import nodemailer from "nodemailer";
import prisma from "../prismaClient.js";
import {
  getInboxCache,
  setInboxCache,
  clearInboxCacheByAccount,
} from "../../cache/inboxCache.js";

const router = express.Router();
const qpDecode = qp.decode;

sgMail.setApiKey(process.env.SENDGRID_API_KEY);
const BASE_URL = process.env.API_BASE_URL || "http://localhost:4002";

function generateId() {
  return randomBytes(16).toString("hex");
}

/* ============================================================
   🧠 Helper – Normalize Subject for Threading
   ============================================================ */
function normalizeSubject(sub) {
  if (!sub) return "";
  return sub
    .toLowerCase()
    .replace(/^re:\s*/g, "")
    .replace(/^fwd?:\s*/g, "")
    .trim();
}

function normalizeEmailHtml(html) {
  if (!html || typeof html !== "string") return "";

  let cleaned = html;

  // 1️⃣ Remove Outlook-only junk
  cleaned = cleaned
    .replace(/<o:p>\s*<\/o:p>/gi, "")
    .replace(/<o:p>.*?<\/o:p>/gi, "")
    .replace(/\sclass=["']?Mso[a-zA-Z0-9]+["']?/gi, "");

  // 2️⃣ Remove ONLY auto-empty blocks (Outlook)
  // ❌ <p>&nbsp;</p>
  // ❌ <div><br></div>
  cleaned = cleaned.replace(
    /<(p|div)[^>]*>(\s|&nbsp;|<br\s*\/?>)*<\/\1>/gi,
    "",
  );

  // 3️⃣ Normalize <p> style (Outlook-like)
  cleaned = cleaned.replace(
    /<p([^>]*)>/gi,
    `<p$1 style="margin:0 0 12px 0;line-height:1.15;font-family:Calibri,Arial,sans-serif;font-size:11pt;">`,
  );

  // 🚫 DO NOT collapse <br><br>
  return cleaned.trim();
}

/* ============================================================
   🧠 Helper – Decode Body
   ============================================================ */
function decodeBody(msg) {
  let decoded = msg.body || "";
  try {
    if (/base64/i.test(msg.encoding || "")) {
      decoded = Buffer.from(msg.body, "base64").toString("utf-8");
    } else if (/quoted-printable/i.test(msg.encoding || "")) {
      decoded = qpDecode(msg.body).toString("utf-8");
    }
    decoded = decoded.replace(/=\r?\n/g, "").trim();
  } catch (err) {
    console.error("⚠️ Decode error:", err);
  }
  return decoded;
}

/* ============================================================
   🔗 Helper – Normalize Attachment URL
   ============================================================ */
function normalizeAttachment(att) {
  if (!att) return null;

  // 🔥 INLINE CID IMAGE → DO NOT CREATE URL
  if (att.cid) {
    return {
      id: att.id || crypto.randomUUID(),
      filename: att.filename || "inline-image",
      mimeType: att.mimeType || "image/png",
      size: att.size || 0,
      url: null, // ✅ VERY IMPORTANT
      cid: att.cid,
      inline: true,
    };
  }

  // Normal file attachment
  const rawUrl = att.storageUrl || att.url || att.path;
  if (!rawUrl) return null;

  return {
    id: att.id || crypto.randomUUID(),
    filename: att.filename || "file",
    mimeType: att.mimeType || "application/octet-stream",
    size: att.size || 0,
    url: rawUrl.startsWith("http")
      ? rawUrl
      : `${BASE_URL}${rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`}`,
    cid: null,
  };
}

async function getEmailsByLeadStatus(leadStatus) {
  if (!leadStatus) return [];

  const leads = await prisma.leadDetails.findMany({
    where: {
      leadStatus: {
        equals: leadStatus,
        mode: "insensitive",
      },
    },
    select: {
      email: true,
      cc: true,
    },
  });

  const emails = new Set();

  leads.forEach((l) => {
    if (l.email) emails.add(l.email.toLowerCase().trim());

    if (l.cc) {
      l.cc
        .split(/[;,]/)
        .map((e) => e.toLowerCase().trim())
        .forEach((e) => e && emails.add(e));
    }
  });

  return [...emails];
}

/* ============================================================
   📥 GET Routes
   ============================================================ */

/* 📥 GET: Inbox Messages (Received + Sent) */
router.get("/messages/inbox", async (req, res) => {
  try {
    const { emailAccountId } = req.query;
    if (!emailAccountId)
      return res.status(400).json({ error: "Missing emailAccountId" });

    const raw = await prisma.emailMessage.findMany({
      where: {
        emailAccountId: Number(emailAccountId),
        OR: [{ direction: "sent" }, { direction: "received" }],
      },
      orderBy: { sentAt: "desc" },
      include: { attachments: true },
    });

    const messages = raw.map((msg) => ({
      id: msg.id,
      fromEmail: msg.fromEmail,
      toEmail: msg.toEmail,
      subject: msg.subject || "(No Subject)",
      body: msg.bodyHtml || decodeBody(msg),
      direction: msg.direction,
      date: msg.sentAt,
      attachments: (msg.attachments || []).map(normalizeAttachment),
    }));

    res.json({ success: true, total: messages.length, data: messages });
  } catch (err) {
    console.error("❌ Inbox fetch error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* 📤 GET: Sent Messages */
router.get("/messages/sent", async (req, res) => {
  try {
    const { emailAccountId } = req.query;
    if (!emailAccountId)
      return res.status(400).json({ error: "Missing emailAccountId" });

    const raw = await prisma.emailMessage.findMany({
      where: { emailAccountId: Number(emailAccountId), direction: "sent" },
      orderBy: { sentAt: "desc" },
      include: { attachments: true },
    });

    const messages = raw.map((msg) => ({
      id: msg.id,
      fromEmail: msg.fromEmail,
      toEmail: msg.toEmail,
      subject: msg.subject || "(No Subject)",
      body: decodeBody(msg),
      direction: "sent",
      date: msg.sentAt,
      attachments: (msg.attachments || []).map(normalizeAttachment),
    }));

    res.json({ success: true, total: messages.length, data: messages });
  } catch (err) {
    console.error("❌ Sent fetch error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* server/routes/inbox.js */
router.get("/conversation-detail", async (req, res) => {
  try {
    const { conversationId, accountId, folder } = req.query;

    if (!conversationId || !accountId) {
      return res.status(400).json({ success: false, message: "Missing IDs" });
    }

    const detailWhere = {
      conversationId,
      emailAccountId: Number(accountId),
    };

    if (folder === "trash") {
      detailWhere.isTrash = true;
      detailWhere.hideTrash = false;
    } else if (folder === "spam") {
      detailWhere.folder = "spam";
      detailWhere.isTrash = false;
      detailWhere.hideTrash = false;
    } else if (folder === "sent") {
      detailWhere.direction = "sent";
      detailWhere.isTrash = false;
      detailWhere.hideInbox = false;
    } else {
      /* 📥 FIX: THIS IS THE INBOX CASE */
      // 1. We remove "detailWhere.folder = 'inbox'" because
      // some messages in this thread are folder='sent' (your replies).

      // 2. Instead, we filter by what we WANT to exclude (Spam and Trash).
      detailWhere.isTrash = false;
      detailWhere.isSpam = false;
      detailWhere.hideInbox = false;

      // 3. (Optional but safer) Explicitly allow both folders
      detailWhere.folder = { in: ["inbox", "sent"] };
    }

    const messages = await prisma.emailMessage.findMany({
      where: detailWhere,
      orderBy: { sentAt: "asc" },
      include: {
        attachments: true,
        tags: { include: { Tag: true } },
      },
    });

    res.json({ success: true, data: messages });
  } catch (err) {
    console.error("❌ FETCH DETAIL ERROR:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});
router.get("/conversation-link", async (req, res) => {
  const { conversationId } = req.query;

  if (!conversationId) {
    return res.status(400).json({
      success: false,
      message: "conversationId is required",
    });
  }

  // 1️⃣ Load conversation
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, leadDetailId: true },
  });

  // 2️⃣ If already linked, return it
  if (conversation?.leadDetailId) {
    return res.json({
      success: true,
      data: { leadDetailId: conversation.leadDetailId },
    });
  }

  // 3️⃣ Fallback: find from EmailMessage
  const msg = await prisma.emailMessage.findFirst({
    where: {
      conversationId,
      leadDetailId: { not: null },
    },
    orderBy: { sentAt: "desc" },
    select: { leadDetailId: true },
  });

  // 4️⃣ If still not found → truly no lead
  if (!msg?.leadDetailId) {
    return res.json({
      success: true,
      data: null,
    });
  }

  // 5️⃣ 🔥 BACKFILL Conversation (THIS IS THE KEY)
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { leadDetailId: msg.leadDetailId },
  });

  // 6️⃣ Return repaired ID
  return res.json({
    success: true,
    data: { leadDetailId: msg.leadDetailId },
  });
});

// ✅ ADD THIS: Matches the exact frontend call with query params
router.get("/conversation-detail/lead", async (req, res) => {
  try {
    const { conversationId } = req.query; // Extracts ID from ?conversationId=...

    if (!conversationId) {
      return res.status(400).json({ success: false, message: "Missing ID" });
    }

    // Decode the ID to handle the < > brackets correctly
    const decodedId = decodeURIComponent(conversationId);

    const conversation = await prisma.conversation.findUnique({
      where: { id: decodedId },
      select: { leadDetailId: true },
    });

    console.log(
      `🔎 DB Search for: ${decodedId} -> Found Lead ID: ${conversation?.leadDetailId}`,
    );

    return res.json({
      success: true,
      leadDetailId: conversation?.leadDetailId || null,
    });
  } catch (err) {
    console.error("❌ Lead Link Fetch Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});
router.get("/conversation/:conversationId/lead", async (req, res) => {
  try {
    // 🔥 FIX: Decode the ID because Message-IDs contain < > brackets
    const conversationId = decodeURIComponent(req.params.conversationId);

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { leadDetailId: true },
    });

    return res.json({
      success: true,
      leadDetailId: conversation?.leadDetailId || null,
    });
  } catch (err) {
    console.error("❌ Lead ID fetch error:", err);
    res.status(500).json({ success: false, leadDetailId: null });
  }
});
router.get("/conversations/:accountId", async (req, res) => {
  try {
    const accountId = Number(req.params.accountId);
    if (!accountId) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid accountId" });
    }

    const {
      folder = "inbox",
      sender,
      recipient,
      subject,
      isUnread,
      isStarred,
      dateFrom,
      dateTo,
      hasAttachment,
      country,
      leadStatus,
      searchEmail,
      followUpHistoryDate, // ✅ ADD THIS LINE
    } = req.query;
    const cacheKey = `inbox:${accountId}:${folder}:${JSON.stringify(req.query)}`;

    const cached = getInboxCache(cacheKey);
    if (cached) {
      return res.json({
        success: true,
        total: cached.length,
        data: cached,
        cached: true,
      });
    }

    /* ==================================================
       1️⃣ BUILD SQL CONDITIONS
    ================================================== */
    const conditions = [];
    const params = [];

    // account
    conditions.push(`em."emailAccountId" = $${params.length + 1}`);
    params.push(accountId);

    // 🔥 GLOBAL SAFETY: never show permanently deleted
    // conditions.push(`em."hideTrash" = false`);
    if (folder === "inbox") {
      conditions.push(`
    em.direction = 'received'
    AND em."isTrash" = false
    AND em."isSpam" = false
    AND em."hideInbox" = false
  `);
    } else if (folder === "sent") {
      conditions.push(`
        em.folder = 'sent'
        AND em.direction = 'sent'
        AND em."isTrash" = false
      `);
    } else if (folder === "spam") {
      conditions.push(`
        em.folder = 'spam'
        AND em."isTrash" = false
      `);
    } else if (folder === "trash") {
      conditions.push(`
    em."isTrash" = true
    AND em."hideTrash" = false
  `);
    }

    // sender / recipient / search
    if (sender || recipient || searchEmail) {
      const val = `%${(sender || recipient || searchEmail)
        .toLowerCase()
        .trim()}%`;
      conditions.push(`
        (
          lower(em."fromEmail") LIKE $${params.length + 1}
          OR lower(em."toEmail") LIKE $${params.length + 1}
          OR lower(em."ccEmail") LIKE $${params.length + 1}
        )
      `);
      params.push(val);
    }

    // subject
    if (subject) {
      conditions.push(`lower(em.subject) LIKE $${params.length + 1}`);
      params.push(`%${subject.toLowerCase()}%`);
    }

    // unread
    if (isUnread === "true") {
      conditions.push(`em."isRead" = false`);
    }

    // starred
    if (isStarred === "true") {
      conditions.push(`em."isStarred" = true`);
    }

    // date range
    if (dateFrom) {
      const parsed = new Date(dateFrom);
      if (!isNaN(parsed.getTime())) {
        conditions.push(`em."sentAt" >= $${params.length + 1}`);
        params.push(parsed);
      }
    }

    if (dateTo) {
      const parsed = new Date(dateTo);
      if (!isNaN(parsed.getTime())) {
        conditions.push(`em."sentAt" <= $${params.length + 1}`);
        params.push(parsed);
      }
    }

    // attachment
    if (hasAttachment === "true") {
      conditions.push(`
        EXISTS (
          SELECT 1 FROM "Attachment" a
          WHERE a."messageId" = em.id
        )
      `);
    }

    // country
    // if (country) {
    //   conditions.push(`
    //     (
    //       lem.country = $${params.length + 1}
    //       OR lem_fallback.country = $${params.length + 1}
    //     )
    //   `);
    //   params.push(country);
    // }

    /* ==================================================
       2️⃣ FETCH MESSAGE IDS
    ================================================== */
    const sql = `
      SELECT DISTINCT em.id
      FROM "EmailMessage" em

      LEFT JOIN "LeadDetails" ld
        ON ld.id = em."leadDetailId"

      LEFT JOIN "LeadEmailMeta" lem
        ON lem."leadDetailId" = ld.id

      LEFT JOIN "LeadEmailMeta" lem_fallback
        ON (
          lower(em."fromEmail") = lower(lem_fallback.email)
          OR lower(em."toEmail") LIKE '%' || lower(lem_fallback.email) || '%'
          OR lower(em."ccEmail") LIKE '%' || lower(lem_fallback.email) || '%'
          OR lower(em."ccEmail") LIKE '%' || lower(lem_fallback.cc) || '%'
        )

      WHERE ${conditions.join(" AND ")}
      ORDER BY em.id DESC
    `;

    const rows = await prisma.$queryRawUnsafe(sql, ...params);
    const messageIds = rows.map((r) => r.id);

    if (messageIds.length === 0) {
      return res.json({ success: true, total: 0, data: [] });
    }

    /* ==================================================
       3️⃣ FETCH CONVERSATIONS
    ================================================== */
    const conversations = await prisma.conversation.findMany({
      where: {
        messages: {
          some:
            folder === "trash"
              ? {
                  id: { in: messageIds },
                  isTrash: true,
                  hideTrash: false,
                  emailAccountId: accountId, // ✅ ADD THIS
                }
              : {
                  id: { in: messageIds },
                  isTrash: false,
                  hideInbox: false,
                  emailAccountId: accountId, // ✅ ADD THIS
                },
        },
      },
      include: {
        messages: {
          where:
            folder === "trash"
              ? {
                  emailAccountId: accountId,
                  isTrash: true,
                  hideTrash: false,
                }
              : {
                  emailAccountId: accountId,
                  isTrash: false,
                  hideInbox: false,
                  isSpam: false,
                },
          orderBy: { sentAt: "desc" },
          take: 1,
        },
      },
      orderBy: { lastMessageAt: "desc" },
    });

    // 🔥 BACKFILL leadDetailId INTO Conversation
    for (const conv of conversations) {
      if (!conv.leadDetailId) {
        const msg = await prisma.emailMessage.findFirst({
          where: {
            conversationId: conv.id,
            leadDetailId: { not: null },
          },
          select: { leadDetailId: true },
          orderBy: { sentAt: "desc" },
        });

        if (msg?.leadDetailId) {
          await prisma.conversation.update({
            where: { id: conv.id },
            data: { leadDetailId: msg.leadDetailId },
          });

          // ✅ CRITICAL: mutate runtime object
          conv.leadDetailId = msg.leadDetailId;
        }
      }
    }

    /* ==================================================
       4️⃣ FORMAT RESPONSE
    ================================================== */
    let result = conversations
      .filter((conv) => conv.messages.length > 0)
      .map((conv) => {
        const m = conv.messages[0];

        let displayName;
        let displayEmail;

        if (m.direction === "received") {
          displayName = m.fromName || m.fromEmail;
          displayEmail = m.fromEmail;
        } else {
          const firstTo = m.toEmail?.split(",")[0] || "";
          displayName = m.toName || firstTo;
          displayEmail = firstTo;
        }

        return {
          conversationId: conv.id,
          subject: conv.subject || "(No Subject)",
          leadDetailId: conv.leadDetailId, // 🔥🔥🔥 THIS IS THE FIX
          initiatorEmail: conv.initiatorEmail,
          lastSenderEmail: m.fromEmail,
          displayName,
          displayEmail,
          lastDate: conv.lastMessageAt,
          // lastBody: m.body?.replace(/<[^>]+>/g, " ").slice(0, 120) || "",
          // 🔥 UPDATED lastBody logic to strip style/script content properly
          lastBody: m.body
            ? m.body
                .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, "") // 1. Remove <style> and <script> contents
                .replace(/<[^>]+>/g, " ") // 2. Remove all remaining HTML tags
                .replace(/&nbsp;/g, " ") // 3. Replace HTML entities
                .replace(/\s+/g, " ") // 4. Collapse multiple spaces/newlines
                .trim()
                .slice(0, 120)
            : "",
          unreadCount: conv.unreadCount,
          messageCount: conv.messageCount,
          isStarred: conv.isStarred,
        };
      });
    /* ==================================================
   🌍 COUNTRY FILTER (FINAL & CORRECT)
================================================== */
    if (country) {
      const leads = await prisma.leadDetails.findMany({
        where: {
          country: {
            equals: country,
            mode: "insensitive",
          },
        },
        select: { id: true },
      });

      const leadIdSet = new Set(leads.map((l) => l.id));

      result = result.filter(
        (conv) => conv.leadDetailId && leadIdSet.has(conv.leadDetailId),
      );
    }

    /* ==================================================
       5️⃣ LEAD STATUS FILTER
    ================================================== */
    // if (leadStatus) {
    //   const leads = await prisma.leadDetails.findMany({
    //     where: {
    //       leadStatus: { equals: leadStatus, mode: "insensitive" },
    //     },
    //     select: { email: true, cc: true },
    //   });

    //   const leadEmails = new Set();
    //   leads.forEach((l) => {
    //     if (l.email) leadEmails.add(l.email.toLowerCase().trim());
    //     if (l.cc) {
    //       l.cc
    //         .split(/[;,]/)
    //         .map((e) => e.toLowerCase().trim())
    //         .forEach((e) => e && leadEmails.add(e));
    //     }
    //   });

    //   const normalize = (s) =>
    //     (s || "").toLowerCase().replace(/<|>|"/g, "").trim();

    //   result = result.filter(
    //     (c) =>
    //       leadEmails.has(normalize(c.displayEmail)) ||
    //       leadEmails.has(normalize(c.lastSenderEmail)) ||
    //       leadEmails.has(normalize(c.initiatorEmail)),
    //   );
    // }
    /* ==================================================
   5️⃣ LEAD STATUS FILTER (FAST & SAFE)
================================================== */
    if (leadStatus) {
      const leads = await prisma.leadDetails.findMany({
        where: {
          leadStatus: {
            equals: leadStatus,
            mode: "insensitive",
          },
        },
        select: { id: true },
      });

      const leadIdSet = new Set(leads.map((l) => l.id));

      result = result.filter(
        (conv) => conv.leadDetailId && leadIdSet.has(conv.leadDetailId),
      );
    }
    /* ==================================================
   📜 FOLLOW-UP HISTORY DATE FILTER
================================================== */
    if (followUpHistoryDate) {
      const leads = await prisma.leadDetails.findMany({
        where: {
          followUpHistory: {
            not: null,
          },
        },
        select: {
          id: true,
          followUpHistory: true,
        },
      });

      const matchedLeadIds = new Set();

      for (const lead of leads) {
        try {
          const history = Array.isArray(lead.followUpHistory)
            ? lead.followUpHistory
            : [];

          const hasMatch = history.some((h) => h?.date === followUpHistoryDate);

          if (hasMatch) {
            matchedLeadIds.add(lead.id);
          }
        } catch (e) {
          // ignore malformed JSON safely
        }
      }

      // 🔥 CRITICAL: If no matches, result becomes EMPTY
      result = result.filter(
        (conv) => conv.leadDetailId && matchedLeadIds.has(conv.leadDetailId),
      );
    }

    /* ==================================================
       6️⃣ RETURN
    ================================================== */
    setInboxCache(cacheKey, result);

    return res.json({
      success: true,
      total: result.length,
      data: result,
    });
  } catch (err) {
    console.error("🔥 Inbox conversations error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to load conversations",
      error: err.message,
    });
  }
});

router.get("/conversations/:accountId/stats", async (req, res) => {
  try {
    const accountId = Number(req.params.accountId);

    // 🔥 Define the logic for what "Inbox" vs "Sent" means for the counts
    const inboxUnread = await prisma.emailMessage.count({
      where: {
        emailAccountId: accountId,
        direction: "received", // Inbox = Received
        isRead: false,
        isSpam: false,
        isTrash: false,
      },
    });

    const sentTotal = await prisma.emailMessage.count({
      where: {
        emailAccountId: accountId,
        direction: "sent", // Sent folder logic
      },
    });

    res.json({
      success: true,
      data: {
        unreadMessages: inboxUnread,
        sentMessages: sentTotal,
      },
    });
  } catch (err) {
    console.error("🔥 Stats Error:", err);
    res.status(500).json({ success: false });
  }
});
/* 📧 GET: All Messages in a Conversation Thread */
router.get("/conversations/:conversationId/messages", async (req, res) => {
  const { conversationId } = req.params;
  const { folder } = req.query;

  const messages = await prisma.emailMessage.findMany({
    where: { conversationId }, // ⬅️ NO FILTERS AT ALL
    orderBy: { sentAt: "asc" },
  });

  console.log(
    "DEBUG messages:",
    messages.map((m) => ({
      id: m.id,
      folder: m.folder,
      hideInbox: m.hideInbox,
      hideTrash: m.hideTrash,
      isTrash: m.isTrash,
      hasHtml: !!m.bodyHtml,
      hasText: !!m.bodyText,
    })),
  );

  res.json({ success: true, data: messages });
});

// server/routes/inbox.js

router.post("/conversations/read", async (req, res) => {
  try {
    const { conversationId } = req.body;

    if (!conversationId) {
      return res.status(400).json({
        success: false,
        message: "Missing conversationId",
      });
    }

    // ✅ ARCHITECTURAL FIX: Use a transaction to keep messages and conversation counts in sync
    await prisma.$transaction([
      // 1. Mark all received messages in this thread as read
      prisma.emailMessage.updateMany({
        where: {
          conversationId: conversationId,
          isRead: false,
          direction: "received",
        },
        data: { isRead: true },
      }),

      // 2. Reset the unread counter for the conversation record
      prisma.conversation.update({
        where: { id: conversationId },
        data: { unreadCount: 0 },
      }),
    ]);

    res.json({ success: true });
  } catch (err) {
    // If the conversation record doesn't exist (P2025), return success for the messages
    if (err.code === "P2025") {
      return res.json({
        success: true,
        warning: "Messages updated; conversation record not found.",
      });
    }

    console.error("❌ Error marking read:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ✅ POST: Mark Entire Conversation as Read */
router.post("/conversations/:conversationId/read", async (req, res) => {
  try {
    const { conversationId } = req.params;

    await prisma.emailMessage.updateMany({
      where: {
        conversationId: conversationId,
        isRead: false,
        direction: "received",
      },
      data: { isRead: true },
    });

    // Update conversation table if it exists
    try {
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { unreadCount: 0 },
      });
    } catch (e) {
      // Conversation table might not exist yet
    }

    res.json({
      success: true,
      message: "Conversation marked as read",
    });
  } catch (err) {
    console.error("❌ Error marking conversation as read:", err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// router.get("/download/:uid/:filename", async (req, res) => {
//   try {
//     const { uid, filename } = req.params;
//     const { accountId } = req.query;

//     if (!accountId) return res.status(400).send("Missing accountId");

//     const account = await prisma.emailAccount.findUnique({
//       where: { id: Number(accountId) },
//     });

//     if (!account) return res.status(404).send("Email account not found");

//     const client = new ImapFlow({
//       host: account.imapHost,
//       port: account.imapPort || 993,
//       secure: true,
//       auth: {
//         user: account.imapUser || account.email,
//         pass: account.encryptedPass,
//       },
//       tls: { rejectUnauthorized: false },
//       // 🔥 ADD TIMEOUTS
//       socketTimeout: 60000,
//       connectionTimeout: 30000,
//     });

//     // 🔥 CRITICAL FIX: Prevent process crash on Socket Timeout
//     client.on("error", (err) => {
//       console.error(`⚠️ IMAP Download Error: ${err.message}`);
//     });

//     await client.connect();
//     // ... rest of your existing logic ...
//     await client.logout().catch(() => {});
//   } catch (err) {
//     console.error("🔥 Download Route Error:", err);
//     res.status(500).json({ error: "Failed to download attachment" });
//   }
// });
router.get("/download/:uid/:filename", async (req, res) => {
  let client; // Define outside to use in finally block
  try {
    const { uid, filename } = req.params;
    const { accountId } = req.query;

    // ... (fetch account logic)

    client = new ImapFlow({
      /* configs */
    });

    // Catch internal imapflow errors
    client.on("error", (err) => console.error("IMAP Client Error:", err));

    await client.connect();
    await client.mailboxOpen("INBOX");

    // ... (fetch logic)
  } catch (err) {
    console.error("🔥 Download Route Error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Socket timeout or connection failed" });
    }
  } finally {
    if (client) {
      await client.logout().catch(() => {}); // Quietly logout
    }
  }
});

/* 🔍 GET: Search Messages */
router.get("/search", async (req, res) => {
  try {
    const { query, accountId } = req.query; // 🔥 ADD accountId

    if (!query) return res.json({ success: true, data: [] });
    if (!accountId)
      return res
        .status(400)
        .json({ success: false, message: "accountId required" });

    const q = query.toLowerCase();

    const messages = await prisma.emailMessage.findMany({
      where: {
        emailAccountId: Number(accountId), // 🔥 FILTER BY ACCOUNT
        OR: [
          { fromEmail: { contains: q, mode: "insensitive" } },
          { toEmail: { contains: q, mode: "insensitive" } },
          { ccEmail: { contains: q, mode: "insensitive" } },
          { subject: { contains: q, mode: "insensitive" } },
          { body: { contains: q, mode: "insensitive" } },
        ],
      },
      orderBy: { sentAt: "desc" },
    });

    res.json({ success: true, data: messages });
  } catch (err) {
    console.error("SEARCH ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* 📊 GET: Account Unread Count */
router.get("/accounts/:id/unread", async (req, res) => {
  try {
    const accountId = Number(req.params.id);

    if (!accountId) {
      return res
        .status(400)
        .json({ success: false, message: "Missing accountId" });
    }

    // Inbox unread (not spam, not trash)
    const inboxUnread = await prisma.emailMessage.count({
      where: {
        emailAccountId: accountId,
        direction: "received",
        isRead: false,
        isSpam: false,
        isTrash: false,
      },
    });

    // Spam unread
    const spamUnread = await prisma.emailMessage.count({
      where: {
        emailAccountId: accountId,
        direction: "received",
        isRead: false,
        isSpam: true,
        isTrash: false,
      },
    });

    return res.json({
      success: true,
      data: {
        inboxUnread,
        spamUnread,
        totalUnread: inboxUnread + spamUnread,
      },
    });
  } catch (err) {
    console.error("🔥 Unread count API error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch unread count",
      error: err.message,
    });
  }
});

/* 📥 GET: Messages by Account ID with Filters */
router.get("/messages/:accountId", async (req, res) => {
  try {
    const accountId = parseInt(req.params.accountId);
    const {
      folder = "inbox",
      unreadOnly,
      sender,
      recipient,
      subject,
      dateFrom,
      dateTo,
      hasAttachment,
      isUnread,
      isStarred,
      status,
    } = req.query;

    // Verify account exists
    const account = await prisma.emailAccount.findUnique({
      where: { id: accountId },
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Email account not found",
      });
    }

    // Build where clause dynamically
    const where = {
      emailAccountId: accountId,
      folder: folder.toLowerCase(),
      isTrash: false, // Don't show deleted messages unless specifically asking for trash
    };

    // Apply filters
    if (unreadOnly === "true" || isUnread === "true") {
      where.isRead = false;
    }

    if (sender) {
      where.fromEmail = {
        contains: sender,
        mode: "insensitive",
      };
    }

    if (recipient) {
      where.toEmail = {
        contains: recipient,
        mode: "insensitive",
      };
    }

    if (subject) {
      where.subject = {
        contains: subject,
        mode: "insensitive",
      };
    }

    if (dateFrom || dateTo) {
      const sentAtFilter = {};

      if (dateFrom) {
        const parsedFrom = new Date(dateFrom);
        if (!isNaN(parsedFrom.getTime())) {
          sentAtFilter.gte = parsedFrom;
        }
      }

      if (dateTo) {
        const parsedTo = new Date(dateTo);
        if (!isNaN(parsedTo.getTime())) {
          sentAtFilter.lte = parsedTo;
        }
      }

      // ✅ Only attach sentAt if at least one valid date exists
      if (Object.keys(sentAtFilter).length > 0) {
        where.sentAt = sentAtFilter;
      }
    }

    if (hasAttachment === "true") {
      where.attachments = {
        some: {},
      };
    }

    // Handle trash folder specially
    if (folder.toLowerCase() === "trash") {
      where.isTrash = true;
      where.hideTrash = false;
    } else {
      where.isTrash = false;
      where.hideInbox = false;
    }

    // Fetch messages
    const messages = await prisma.emailMessage.findMany({
      where,
      include: {
        attachments: true,
        tags: {
          include: {
            Tag: true,
          },
        },
      },
      orderBy: {
        sentAt: "desc",
      },
    });

    // Format response to match frontend expectations
    const formattedMessages = messages.map((msg) => ({
      id: msg.id,
      messageId: msg.messageId,
      emailAccountId: msg.emailAccountId,
      fromEmail: msg.fromEmail,
      toEmail: msg.toEmail,
      ccEmail: msg.ccEmail,
      subject: msg.subject,
      body: msg.body || msg.bodyHtml,
      bodyHtml: msg.bodyHtml,
      direction: msg.direction,
      sentAt: msg.sentAt,
      isRead: msg.isRead,
      isStarred: msg.isStarred || false,
      folder: msg.folder,
      isDraft: msg.isDraft,
      isSpam: msg.isSpam,
      isTrash: msg.isTrash,
      uid: msg.uid,
      attachments: msg.attachments || [],
      tags: msg.tags?.map((t) => t.Tag) || [],
    }));

    return res.json({
      success: true,
      data: formattedMessages,
      count: formattedMessages.length,
    });
  } catch (error) {
    console.error("❌ Error fetching inbox messages:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch messages",
      error: error.message,
    });
  }
});

/* 🌍 GET: Countries */
router.get("/countries", async (req, res) => {
  try {
    const countries = await prisma.leadDetails.findMany({
      where: {
        country: { not: null },
      },
      select: {
        country: true,
      },
      distinct: ["country"],
      orderBy: {
        country: "asc",
      },
    });

    res.json({
      success: true,
      data: countries.map((c) => c.country).filter(Boolean),
    });
  } catch (err) {
    console.error("❌ Error fetching countries:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch countries",
    });
  }
});

/* 🌍 GET: Conversation Country */
router.get("/conversation/:email/country", async (req, res) => {
  try {
    const { email } = req.params;
    const { emailAccountId } = req.query;

    const leadDetail = await prisma.leadDetails.findFirst({
      where: {
        OR: [
          { email: email },
          { email: { contains: email, mode: "insensitive" } },
        ],
      },
      include: { leadEmailMeta: true },
    });

    let country = null;
    if (leadDetail?.leadEmailMeta?.country) {
      country = leadDetail.leadEmailMeta.country;
    } else if (leadDetail?.country) {
      country = leadDetail.country;
    }

    return res.json({ success: true, country });
  } catch (error) {
    console.error("Error fetching country:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch country" });
  }
});

/* 👤 GET: Account User */
router.get("/accounts/:accountId/user", async (req, res) => {
  try {
    const { accountId } = req.params;

    const account = await prisma.emailAccount.findUnique({
      where: { id: parseInt(accountId) },
      include: {
        User: { select: { name: true, email: true } },
      },
    });

    if (!account) {
      return res
        .status(404)
        .json({ success: false, message: "Account not found" });
    }

    return res.json({
      success: true,
      userName: account.User?.name || null,
      userEmail: account.User?.email || null,
    });
  } catch (error) {
    console.error("Error fetching user name:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch user name" });
  }
});

/* 📊 GET: Account Statistics */
router.get("/stats/:accountId", async (req, res) => {
  try {
    const accountId = parseInt(req.params.accountId);

    const [
      totalMessages,
      unreadCount,
      inboxCount,
      sentCount,
      spamCount,
      trashCount,
    ] = await Promise.all([
      prisma.emailMessage.count({
        where: { emailAccountId: accountId, isTrash: false },
      }),
      prisma.emailMessage.count({
        where: {
          emailAccountId: accountId,
          isRead: false,
          folder: "inbox",
          isTrash: false,
        },
      }),
      prisma.emailMessage.count({
        where: { emailAccountId: accountId, folder: "inbox", isTrash: false },
      }),
      prisma.emailMessage.count({
        where: { emailAccountId: accountId, folder: "sent", isTrash: false },
      }),
      prisma.emailMessage.count({
        where: { emailAccountId: accountId, folder: "spam", isTrash: false },
      }),
      prisma.emailMessage.count({
        where: { emailAccountId: accountId, isTrash: true },
      }),
    ]);

    return res.json({
      success: true,
      data: {
        total: totalMessages,
        unread: unreadCount,
        inbox: inboxCount,
        sent: sentCount,
        spam: spamCount,
        trash: trashCount,
      },
    });
  } catch (error) {
    console.error("❌ Error fetching stats:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch stats",
      error: error.message,
    });
  }
});

/* ============================================================
   📤 POST Routes
   ============================================================ */
// router.post("/reply", async (req, res) => {
//   try {
//     const {
//       emailAccountId,
//       to, // 🔥 ACCEPT TO FROM UI
//       cc,
//       body,
//       attachments = [],
//       replyToMessageId,
//     } = req.body;

//     /* =====================================================
//        0️⃣ VALIDATION
//     ===================================================== */
//     if (!emailAccountId || !replyToMessageId || !body) {
//       return res.status(400).json({
//         success: false,
//         message: "emailAccountId, replyToMessageId and body are required",
//       });
//     }

//     /* =====================================================
//        1️⃣ FETCH EMAIL ACCOUNT
//     ===================================================== */
//     const account = await prisma.emailAccount.findUnique({
//       where: { id: Number(emailAccountId) },
//     });

//     if (!account) {
//       return res.status(404).json({
//         success: false,
//         message: "Email account not found",
//       });
//     }

//     const senderName = account.senderName || null;
//     const authEmail = (account.smtpUser || account.email).toLowerCase().trim();

//     /* =====================================================
//        🔧 HELPERS
//     ===================================================== */
//     const extractEmail = (val) => {
//       if (!val) return null;
//       const match = val.match(/<([^>]+)>/);
//       return (match ? match[1] : val).trim().toLowerCase();
//     };

//     const cleanList = (val) =>
//       val ? val.split(",").map(extractEmail).filter(Boolean) : [];

//     /* =====================================================
//        2️⃣ FETCH ORIGINAL MESSAGE
//     ===================================================== */
//     const originalMessage = await prisma.emailMessage.findUnique({
//       where: { id: Number(replyToMessageId) },
//     });

//     if (!originalMessage) {
//       return res.status(404).json({
//         success: false,
//         message: "Original message not found",
//       });
//     }

//     const conversationId = originalMessage.conversationId;

//     // const inReplyTo = originalMessage.messageId;
//     // const references = originalMessage.references
//     //   ? `${originalMessage.references} ${originalMessage.messageId}`
//     //   : originalMessage.messageId;
//     const inReplyTo = originalMessage.messageId;

//     // 🔒 LIMIT REFERENCES (PREVENT HEADER BLOAT / SPAM FLAGS)
//     const MAX_REFERENCES = 5;

//     const refParts = (originalMessage.references || "")
//       .split(" ")
//       .filter(Boolean)
//       .slice(-MAX_REFERENCES);

//     const references = [...refParts, originalMessage.messageId].join(" ");

//     /* =====================================================
//        3️⃣ DEFAULT CLIENT EMAIL (FALLBACK ONLY)
//     ===================================================== */
//     let fallbackClientEmail =
//       originalMessage.direction === "received"
//         ? extractEmail(originalMessage.fromEmail)
//         : extractEmail(originalMessage.toEmail?.split(",")[0]);

//     if (!fallbackClientEmail) {
//       return res.status(400).json({
//         success: false,
//         message: "Unable to resolve fallback client email",
//       });
//     }

//     /* =====================================================
//        4️⃣ FINAL TO / CC RESOLUTION (🔥 FIX)
//     ===================================================== */
//     const finalToList = cleanList(to);
//     const finalTo =
//       finalToList.length > 0 ? finalToList.join(", ") : fallbackClientEmail;

//     const finalCc = cleanList(cc)
//       .filter((e) => e !== authEmail && !finalToList.includes(e))
//       .join(", ");

//     /* =====================================================
//        5️⃣ SUBJECT
//     ===================================================== */
//     const baseSubject = originalMessage.subject || "";
//     const finalSubject = baseSubject.toLowerCase().startsWith("re:")
//       ? baseSubject
//       : `Re: ${baseSubject}`;

//     /* =====================================================
//        6️⃣ BODY
//     ===================================================== */
//     const normalizedBody = normalizeEmailHtml(body);

//     /* =====================================================
//        7️⃣ SMTP
//     ===================================================== */
//     const transporter = nodemailer.createTransport({
//       host: account.smtpHost,
//       port: account.smtpPort || 465,
//       secure: (account.smtpPort || 465) === 465,
//       auth: {
//         user: authEmail,
//         pass: account.encryptedPass,
//       },
//     });

//     const smtpAttachments = attachments.map((file) => ({
//       filename: file.filename || file.name,
//       path: file.url,
//       contentType: file.mimeType || file.type,
//     }));

//     const replyMessageId = `<${Date.now()}.${Math.random()
//       .toString(36)
//       .slice(2)}@${authEmail.split("@")[1]}>`;

//     const smtpFrom = senderName ? `"${senderName}" <${authEmail}>` : authEmail;

//     /* =====================================================
//        8️⃣ SEND MAIL
//     ===================================================== */
//     await transporter.sendMail({
//       from: smtpFrom,
//       to: finalTo, // ✅ UI OVERRIDES
//       cc: finalCc || undefined,
//       subject: finalSubject,
//       html: normalizedBody,
//       text: htmlToText(normalizedBody, { wordwrap: 80 }),

//       attachments: smtpAttachments,
//       messageId: replyMessageId,
//       headers: {
//         "In-Reply-To": inReplyTo,
//         References: references,
//       },
//     });

//     /* =====================================================
//        9️⃣ SAVE MESSAGE
//     ===================================================== */
//     const savedReply = await prisma.emailMessage.create({
//       data: {
//         emailAccountId: Number(emailAccountId),
//         conversationId,

//         messageId: replyMessageId,
//         fromEmail: authEmail,
//         fromName: senderName,

//         toEmail: finalTo,
//         ccEmail: finalCc || null,

//         subject: finalSubject,
//         body: normalizedBody,

//         direction: "sent",
//         sentAt: new Date(),
//         folder: "sent",
//         isRead: true,

//         inReplyTo,
//         references,
//       },
//     });

//     /* =====================================================
//        🔟 UPDATE CONVERSATION
//     ===================================================== */
//     if (conversationId) {
//       await prisma.conversation.update({
//         where: { id: conversationId },
//         data: {
//           lastMessageAt: new Date(),
//           messageCount: { increment: 1 },
//         },
//       });
//     }

//     return res.json({
//       success: true,
//       message: "Reply sent successfully",
//       data: savedReply,
//     });
//   } catch (err) {
//     console.error("❌ Reply error:", err);
//     return res.status(500).json({
//       success: false,
//       error: "Failed to send reply",
//       details: err.message,
//     });
//   }
// });
router.post("/reply", async (req, res) => {
  try {
    const {
      emailAccountId,
      to, // 🔥 Logic: Accept updated "To" list from UI
      cc, // 🔥 Logic: Accept updated "CC" list from UI
      body,
      attachments = [],
      replyToMessageId,
    } = req.body;

    /* =====================================================
       1️⃣ VALIDATION & ACCOUNT FETCH
    ===================================================== */
    if (!emailAccountId || !replyToMessageId || !body) {
      return res.status(400).json({
        success: false,
        message: "emailAccountId, replyToMessageId and body are required",
      });
    }

    const account = await prisma.emailAccount.findUnique({
      where: { id: Number(emailAccountId) },
    });

    if (!account)
      return res
        .status(404)
        .json({ success: false, message: "Account not found" });

    const authEmail = (account.smtpUser || account.email).toLowerCase().trim();
    const senderName = account.senderName || null;

    /* =====================================================
       2️⃣ FETCH ORIGINAL MESSAGE & THREAD HEADERS
    ===================================================== */
    const originalMessage = await prisma.emailMessage.findUnique({
      where: { id: Number(replyToMessageId) },
    });

    if (!originalMessage)
      return res
        .status(404)
        .json({ success: false, message: "Original message not found" });

    const conversationId = originalMessage.conversationId;
    const inReplyTo = originalMessage.messageId;

    // Limit references to prevent header bloat and spam flags
    const MAX_REFERENCES = 5;
    const refParts = (originalMessage.references || "")
      .split(" ")
      .filter(Boolean)
      .slice(-MAX_REFERENCES);
    const references = [...refParts, originalMessage.messageId].join(" ");

    /* =====================================================
       3️⃣ 🔥 RECIPIENT LOGIC (HANDLES ALL UI CHANGES)
    ===================================================== */
    // Helper to clean and format email strings into arrays
    const cleanList = (val) =>
      val
        ? val
            .split(",")
            .map((e) => e.trim())
            .filter((e) => e.includes("@"))
        : [];

    const finalToList = cleanList(to);
    const finalCcList = cleanList(cc).filter(
      (e) => e !== authEmail && !finalToList.includes(e),
    );

    // 🛡️ THE ENVELOPE: This ensures physical delivery to every address in the UI
    const allRecipients = [...finalToList, ...finalCcList];

    if (allRecipients.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No valid recipients found" });
    }

    /* =====================================================
       4️⃣ SMTP CONFIGURATION & SENDING
    ===================================================== */
    const transporter = nodemailer.createTransport({
      host: account.smtpHost,
      port: account.smtpPort || 465,
      secure: (account.smtpPort || 465) === 465,
      auth: {
        user: authEmail,
        pass: account.encryptedPass,
      },
    });

    const normalizedBody = normalizeEmailHtml(body);
    const replyMessageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@${authEmail.split("@")[1]}>`;
    const smtpFrom = senderName ? `"${senderName}" <${authEmail}>` : authEmail;

    await transporter.sendMail({
      from: smtpFrom,
      to: finalToList.join(", "),
      ...(finalCcList.length > 0 && { cc: finalCcList.join(", ") }), // Only add CC header if list is not empty

      // 🛡️ CRITICAL FIX: Explicit routing to ensure CCs are delivered
      // This matches the "Trust" logic used in your initial SMTP route
      envelope: {
        from: authEmail,
        to: allRecipients,
      },

      subject: originalMessage.subject?.toLowerCase().startsWith("re:")
        ? originalMessage.subject
        : `Re: ${originalMessage.subject}`,
      html: normalizedBody,
      text: htmlToText(normalizedBody, { wordwrap: 80 }),

      messageId: replyMessageId,
      headers: {
        "In-Reply-To": inReplyTo,
        References: references,
        "X-Mailer": "Microsoft Outlook",
      },
      attachments: attachments.map((file) => ({
        filename: file.filename || file.name,
        path: file.url,
        contentType: file.mimeType || file.type,
      })),
    });

    /* =====================================================
       5️⃣ SAVE TO DATABASE & UPDATE CONVERSATION
    ===================================================== */
    const savedReply = await prisma.emailMessage.create({
      data: {
        emailAccountId: Number(emailAccountId),
        conversationId,
        messageId: replyMessageId,
        fromEmail: authEmail,
        fromName: senderName,
        toEmail: finalToList.join(", "),
        ccEmail: finalCcList.join(", ") || null,
        subject: originalMessage.subject,
        body: normalizedBody,
        direction: "sent",
        sentAt: new Date(),
        folder: "sent",
        isRead: true,
        inReplyTo,
        references,
        leadDetailId: originalMessage.leadDetailId,
      },
    });

    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: new Date(),
        messageCount: { increment: 1 },
      },
    });

    return res.json({ success: true, data: savedReply });
  } catch (err) {
    console.error("❌ Reply error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// router.post("/reply-all", async (req, res) => {
//   try {
//     const {
//       emailAccountId,
//       replyToMessageId,
//       conversationId,
//       to, // 🔥 accept from UI
//       cc, // 🔥 accept from UI
//       body,
//       attachments = [],
//     } = req.body;

//     /* =====================================================
//        0️⃣ VALIDATION
//     ===================================================== */
//     if (!emailAccountId || !body || (!replyToMessageId && !conversationId)) {
//       return res.status(400).json({
//         success: false,
//         message: "emailAccountId, body and reply target are required",
//       });
//     }

//     /* =====================================================
//        1️⃣ FETCH EMAIL ACCOUNT
//     ===================================================== */
//     const account = await prisma.emailAccount.findUnique({
//       where: { id: Number(emailAccountId) },
//     });

//     if (!account) {
//       return res.status(404).json({
//         success: false,
//         message: "Email account not found",
//       });
//     }

//     const senderName = account.senderName || null;
//     const authEmail = (account.smtpUser || account.email).toLowerCase().trim();

//     /* =====================================================
//        🔧 HELPERS
//     ===================================================== */
//     const extractEmail = (val) => {
//       if (!val) return null;
//       const match = val.match(/<([^>]+)>/);
//       return (match ? match[1] : val).trim().toLowerCase();
//     };

//     const cleanList = (val) =>
//       val ? val.split(",").map(extractEmail).filter(Boolean) : [];

//     /* =====================================================
//        2️⃣ FETCH ORIGINAL MESSAGE
//     ===================================================== */
//     let originalMessage = null;

//     if (replyToMessageId) {
//       originalMessage = await prisma.emailMessage.findUnique({
//         where: { id: Number(replyToMessageId) },
//       });
//     }

//     if (!originalMessage && conversationId) {
//       originalMessage = await prisma.emailMessage.findFirst({
//         where: { conversationId },
//         orderBy: { sentAt: "desc" },
//       });
//     }

//     if (!originalMessage) {
//       return res.status(400).json({
//         success: false,
//         message: "Original message not found",
//       });
//     }

//     const convId = originalMessage.conversationId;

//     /* =====================================================
//        3️⃣ THREAD HEADERS
//     ===================================================== */
//     // const inReplyTo = originalMessage.messageId;
//     // const references = originalMessage.references
//     //   ? `${originalMessage.references} ${originalMessage.messageId}`
//     //   : originalMessage.messageId;
//     const inReplyTo = originalMessage.messageId;

//     // 🔒 LIMIT REFERENCES (PREVENT HEADER BLOAT / SPAM FLAGS)
//     const MAX_REFERENCES = 5;

//     const refParts = (originalMessage.references || "")
//       .split(" ")
//       .filter(Boolean)
//       .slice(-MAX_REFERENCES);

//     const references = [...refParts, originalMessage.messageId].join(" ");

//     /* =====================================================
//        4️⃣ BACKEND DEFAULT RECIPIENTS (FALLBACK ONLY)
//     ===================================================== */
//     const fallbackClientEmail =
//       originalMessage.direction === "received"
//         ? extractEmail(originalMessage.fromEmail)
//         : extractEmail(originalMessage.toEmail?.split(",")[0]);

//     if (!fallbackClientEmail || fallbackClientEmail === authEmail) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid fallback client email",
//       });
//     }

//     const fallbackToList = [fallbackClientEmail];

//     const fallbackCcSet = new Set(
//       [
//         ...(originalMessage.toEmail || "").split(","),
//         ...(originalMessage.ccEmail || "").split(","),
//       ]
//         .map(extractEmail)
//         .filter((e) => e && e !== authEmail && e !== fallbackClientEmail),
//     );

//     /* =====================================================
//        5️⃣ FINAL TO / CC (🔥 UI OVERRIDES)
//     ===================================================== */
//     const uiToList = cleanList(to);
//     const uiCcList = cleanList(cc);

//     const finalToList = uiToList.length > 0 ? uiToList : fallbackToList;

//     const finalCcList =
//       uiCcList.length > 0
//         ? uiCcList.filter((e) => e !== authEmail && !finalToList.includes(e))
//         : [...fallbackCcSet];

//     const finalTo = finalToList.join(", ");
//     const finalCc = finalCcList.join(", ");

//     /* =====================================================
//        6️⃣ SUBJECT + BODY
//     ===================================================== */
//     const baseSubject = originalMessage.subject || "";
//     const finalSubject = baseSubject.toLowerCase().startsWith("re:")
//       ? baseSubject
//       : `Re: ${baseSubject}`;

//     const normalizedBody = normalizeEmailHtml(body);

//     /* =====================================================
//        7️⃣ SMTP
//     ===================================================== */
//     const transporter = nodemailer.createTransport({
//       host: account.smtpHost,
//       port: account.smtpPort || 465,
//       secure: (account.smtpPort || 465) === 465,
//       auth: {
//         user: authEmail,
//         pass: account.encryptedPass,
//       },
//     });

//     const replyMessageId = `<${Date.now()}.${Math.random()
//       .toString(36)
//       .slice(2)}@${authEmail.split("@")[1]}>`;

//     const smtpFrom = senderName ? `"${senderName}" <${authEmail}>` : authEmail;

//     /* =====================================================
//        8️⃣ SEND MAIL
//     ===================================================== */
//     await transporter.sendMail({
//       from: smtpFrom,
//       to: finalTo, // ✅ UI OR FALLBACK
//       cc: finalCc || undefined, // ✅ UI OR FALLBACK
//       subject: finalSubject,
//       html: normalizedBody,
//       text: htmlToText(normalizedBody, { wordwrap: 80 }),
//       messageId: replyMessageId,
//       headers: {
//         "In-Reply-To": inReplyTo,
//         References: references,
//       },
//       attachments: attachments.map((f) => ({
//         filename: f.filename || f.name,
//         path: f.url,
//         contentType: f.mimeType || f.type,
//       })),
//     });

//     /* =====================================================
//        9️⃣ SAVE MESSAGE
//     ===================================================== */
//     const saved = await prisma.emailMessage.create({
//       data: {
//         emailAccountId: Number(emailAccountId),
//         conversationId: convId,

//         messageId: replyMessageId,
//         fromEmail: authEmail,
//         fromName: senderName,

//         toEmail: finalTo,
//         ccEmail: finalCc || null,

//         subject: finalSubject,
//         body: normalizedBody,

//         direction: "sent",
//         sentAt: new Date(),
//         folder: "sent",
//         isRead: true,

//         inReplyTo,
//         references,
//       },
//     });

//     /* =====================================================
//        🔟 UPDATE CONVERSATION
//     ===================================================== */
//     await prisma.conversation.update({
//       where: { id: convId },
//       data: {
//         lastMessageAt: new Date(),
//         messageCount: { increment: 1 },
//       },
//     });

//     return res.json({ success: true, data: saved });
//   } catch (err) {
//     console.error("❌ Reply-All error:", err);
//     return res.status(500).json({
//       success: false,
//       error: "Failed to send reply-all",
//       details: err.message,
//     });
//   }
// });
router.post("/reply-all", async (req, res) => {
  try {
    const {
      emailAccountId,
      replyToMessageId,
      conversationId,
      to, // 🔥 Logic: Capture updated "To" list from UI
      cc, // 🔥 Logic: Capture updated "CC" list from UI
      body,
      attachments = [],
    } = req.body;

    /* =====================================================
       1️⃣ VALIDATION & ACCOUNT FETCH
    ===================================================== */
    if (!emailAccountId || !body || (!replyToMessageId && !conversationId)) {
      return res.status(400).json({
        success: false,
        message: "emailAccountId, body and reply target are required",
      });
    }

    const account = await prisma.emailAccount.findUnique({
      where: { id: Number(emailAccountId) },
    });

    if (!account)
      return res
        .status(404)
        .json({ success: false, message: "Account not found" });

    const authEmail = (account.smtpUser || account.email).toLowerCase().trim();
    const senderName = account.senderName || null;

    /* =====================================================
       2️⃣ FETCH ORIGINAL MESSAGE & THREADING
    ===================================================== */
    let originalMessage = replyToMessageId
      ? await prisma.emailMessage.findUnique({
          where: { id: Number(replyToMessageId) },
        })
      : await prisma.emailMessage.findFirst({
          where: { conversationId },
          orderBy: { sentAt: "desc" },
        });

    if (!originalMessage)
      return res
        .status(400)
        .json({ success: false, message: "Original message not found" });

    const convId = originalMessage.conversationId;
    const inReplyTo = originalMessage.messageId;

    // Limit references to 5 to prevent delivery rejection
    const MAX_REFERENCES = 5;
    const refParts = (originalMessage.references || "")
      .split(" ")
      .filter(Boolean)
      .slice(-MAX_REFERENCES);
    const references = [...refParts, originalMessage.messageId].join(" ");

    /* =====================================================
       3️⃣ 🔥 RECIPIENT LOGIC (HANDLES ALL UI CHANGES)
    ===================================================== */
    // Helper to clean and format email strings into arrays
    const cleanList = (val) =>
      val
        ? val
            .split(",")
            .map((e) => e.trim())
            .filter((e) => e.includes("@"))
        : [];

    const finalToList = cleanList(to);
    // CC list filters out the sender to prevent "loop" emails
    const finalCcList = cleanList(cc).filter(
      (e) => e !== authEmail && !finalToList.includes(e),
    );

    // 🛡️ THE ENVELOPE: Ensures physical routing to every email currently in the UI
    const allRecipients = [...finalToList, ...finalCcList];

    if (allRecipients.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No recipients selected" });
    }

    /* =====================================================
       4️⃣ SMTP CONFIGURATION & SENDING
    ===================================================== */
    const transporter = nodemailer.createTransport({
      host: account.smtpHost,
      port: account.smtpPort || 465,
      secure: (account.smtpPort || 465) === 465,
      auth: {
        user: authEmail,
        pass: account.encryptedPass,
      },
    });

    const normalizedBody = normalizeEmailHtml(body);
    const replyMessageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@${authEmail.split("@")[1]}>`;
    const smtpFrom = senderName ? `"${senderName}" <${authEmail}>` : authEmail;

    await transporter.sendMail({
      from: smtpFrom,
      to: finalToList.join(", "),
      ...(finalCcList.length > 0 && { cc: finalCcList.join(", ") }),

      // 🛡️ ENVELOPE LOGIC: Aligns Return-Path with auth email to establish trust
      envelope: {
        from: authEmail,
        to: allRecipients,
      },

      subject: originalMessage.subject?.toLowerCase().startsWith("re:")
        ? originalMessage.subject
        : `Re: ${originalMessage.subject}`,
      html: normalizedBody,
      text: htmlToText(normalizedBody, { wordwrap: 80 }),

      messageId: replyMessageId,
      headers: {
        "In-Reply-To": inReplyTo,
        References: references,
        "X-Mailer": "Microsoft Outlook",
      },
      attachments: attachments.map((f) => ({
        filename: f.filename || f.name,
        path: f.url,
        contentType: f.mimeType || f.type,
      })),
    });

    /* =====================================================
       5️⃣ SAVE MESSAGE & UPDATE CONVERSATION
    ===================================================== */
    const saved = await prisma.emailMessage.create({
      data: {
        emailAccountId: Number(emailAccountId),
        conversationId: convId,
        messageId: replyMessageId,
        fromEmail: authEmail,
        fromName: senderName,
        toEmail: finalToList.join(", "),
        ccEmail: finalCcList.join(", ") || null,
        subject: originalMessage.subject,
        body: normalizedBody,
        direction: "sent",
        sentAt: new Date(),
        folder: "sent",
        isRead: true,
        inReplyTo,
        references,
        leadDetailId: originalMessage.leadDetailId,
      },
    });

    await prisma.conversation.update({
      where: { id: convId },
      data: {
        lastMessageAt: new Date(),
        messageCount: { increment: 1 },
      },
    });

    return res.json({ success: true, data: saved });
  } catch (err) {
    console.error("❌ Reply-All error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});
// router.post("/forward", async (req, res) => {
//   try {
//     const {
//       emailAccountId,
//       forwardMessageId,
//       conversationId,
//       to,
//       cc,
//       body,
//       attachments = [],
//     } = req.body;

//     if (!emailAccountId || !to) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Missing fields" });
//     }

//     /* ===============================
//        1️⃣ Find original message
//     =============================== */
//     let original = null;

//     if (forwardMessageId) {
//       original = await prisma.emailMessage.findUnique({
//         where: { id: Number(forwardMessageId) },
//       });
//     }

//     if (!original && conversationId) {
//       original = await prisma.emailMessage.findFirst({
//         where: { conversationId },
//         orderBy: { sentAt: "desc" },
//       });
//     }

//     if (!original) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Original not found" });
//     }
//     /* ===============================
//    🔥 1️⃣.5 RESOLVE LEAD (ADD HERE)
// =============================== */
//     const leadSource = await prisma.emailMessage.findFirst({
//       where: {
//         conversationId: original.conversationId,
//         leadDetailId: { not: null },
//       },
//       select: { leadDetailId: true },
//       orderBy: { sentAt: "desc" },
//     });
//     /* ===============================
//        2️⃣ Fetch account
//     =============================== */
//     const account = await prisma.emailAccount.findUnique({
//       where: { id: Number(emailAccountId) },
//     });

//     if (!account) {
//       return res.status(404).json({
//         success: false,
//         message: "Account not found",
//       });
//     }

//     const senderName = account.senderName || null;
//     const authEmail = (account.smtpUser || account.email).toLowerCase();

//     /* ===============================
//        3️⃣ NEW conversation
//     =============================== */
//     const newConversationId = crypto.randomUUID();

//     const finalSubject = original.subject?.startsWith("Fwd:")
//       ? original.subject
//       : `Fwd: ${original.subject || ""}`;

//     await prisma.conversation.create({
//       data: {
//         id: newConversationId,
//         subject: finalSubject,
//         leadDetailId: leadSource?.leadDetailId || null,

//         initiatorEmail: authEmail,
//         participants: authEmail,

//         toRecipients: to,
//         ccRecipients: cc || null,

//         lastMessageAt: new Date(),
//         messageCount: 1,
//         unreadCount: 0,
//       },
//     });

//     /* ===============================
//        4️⃣ SMTP
//     =============================== */
//     const transporter = nodemailer.createTransport({
//       host: account.smtpHost,
//       port: account.smtpPort || 465,
//       secure: Number(account.smtpPort) === 465,
//       auth: { user: authEmail, pass: account.encryptedPass },
//     });

//     const forwardedBody = `
//       ${body || ""}
//       <br><hr>
//       <b>From:</b> ${original.fromEmail}<br>
//       <b>Sent:</b> ${original.sentAt.toLocaleString()}<br>
//       <b>Subject:</b> ${original.subject}<br><br>
//       ${original.body || ""}
//     `;

//     const normalizedBody = normalizeEmailHtml(forwardedBody);

//     const msgId = `<${Date.now()}.${Math.random()
//       .toString(36)
//       .slice(2)}@${authEmail.split("@")[1]}>`;

//     const smtpFrom = senderName ? `"${senderName}" <${authEmail}>` : authEmail;

//     /* ===============================
//        5️⃣ SEND MAIL
//     =============================== */
//     await transporter.sendMail({
//       from: smtpFrom,
//       to, // ✅ EXACT as provided
//       cc: cc || undefined,
//       subject: finalSubject,
//       html: normalizedBody,
//       text: htmlToText(normalizedBody, { wordwrap: 80 }),
//       messageId: msgId,
//       attachments: attachments.map((f) => ({
//         filename: f.filename || f.name,
//         path: f.url,
//       })),
//     });

//     /* ===============================
//        6️⃣ SAVE MESSAGE
//     =============================== */
//     const saved = await prisma.emailMessage.create({
//       data: {
//         emailAccountId: Number(emailAccountId),
//         conversationId: newConversationId,
//         leadDetailId: leadSource?.leadDetailId || null, // 🔥 MISSING FIX

//         messageId: msgId,
//         fromEmail: authEmail,
//         fromName: senderName,

//         toEmail: to,
//         ccEmail: cc || null,

//         subject: finalSubject,
//         body: normalizedBody,
//         direction: "sent",
//         sentAt: new Date(),
//         folder: "sent", // ✅ SENT (not inbox)
//         isRead: true,
//       },
//     });

//     return res.json({ success: true, data: saved });
//   } catch (err) {
//     console.error("❌ Forward error:", err);
//     res.status(500).json({ success: false });
//   }
// });
router.post("/forward", async (req, res) => {
  try {
    const {
      emailAccountId,
      forwardMessageId,
      conversationId,
      to, // 🔥 Logic: Capture "To" from UI
      cc, // 🔥 Logic: Capture "CC" from UI
      body,
      attachments = [],
    } = req.body;

    /* =====================================================
       1️⃣ VALIDATION & ACCOUNT FETCH
    ===================================================== */
    if (!emailAccountId || !to) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields (emailAccountId, to)",
      });
    }

    const account = await prisma.emailAccount.findUnique({
      where: { id: Number(emailAccountId) },
    });

    if (!account)
      return res
        .status(404)
        .json({ success: false, message: "Account not found" });

    const authEmail = (account.smtpUser || account.email).toLowerCase().trim();
    const senderName = account.senderName || null;

    /* =====================================================
       2️⃣ FETCH ORIGINAL MESSAGE & LEAD DATA
    ===================================================== */
    let original = forwardMessageId
      ? await prisma.emailMessage.findUnique({
          where: { id: Number(forwardMessageId) },
        })
      : await prisma.emailMessage.findFirst({
          where: { conversationId },
          orderBy: { sentAt: "desc" },
        });

    if (!original)
      return res
        .status(400)
        .json({ success: false, message: "Original message not found" });

    // Logic: Carry over the leadDetailId to the new forwarded conversation
    const leadDetailId = original.leadDetailId;

    /* =====================================================
       3️⃣ 🔥 RECIPIENT LOGIC (HANDLES ALL UI CHANGES)
    ===================================================== */
    const cleanList = (val) =>
      val
        ? val
            .split(",")
            .map((e) => e.trim())
            .filter((e) => e.includes("@"))
        : [];

    const finalToList = cleanList(to);
    const finalCcList = cleanList(cc).filter(
      (e) => e !== authEmail && !finalToList.includes(e),
    );

    // 🛡️ THE ENVELOPE: Ensures physical routing to the new forward targets
    const allRecipients = [...finalToList, ...finalCcList];

    if (allRecipients.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No valid recipients found" });
    }

    /* =====================================================
       4️⃣ CREATE NEW CONVERSATION (FORWARDS START NEW THREADS)
    ===================================================== */
    const newConversationId = crypto.randomUUID();
    const finalSubject = original.subject?.startsWith("Fwd:")
      ? original.subject
      : `Fwd: ${original.subject || ""}`;

    await prisma.conversation.create({
      data: {
        id: newConversationId,
        subject: finalSubject,
        leadDetailId,
        initiatorEmail: authEmail,
        participants: [authEmail, ...finalToList, ...finalCcList].join(", "),
        toRecipients: finalToList.join(", "),
        ccRecipients: finalCcList.join(", ") || null,
        lastMessageAt: new Date(),
        messageCount: 1,
        unreadCount: 0,
      },
    });

    /* =====================================================
       5️⃣ SMTP CONFIGURATION & SENDING
    ===================================================== */
    const transporter = nodemailer.createTransport({
      host: account.smtpHost,
      port: account.smtpPort || 465,
      secure: (account.smtpPort || 465) === 465,
      auth: {
        user: authEmail,
        pass: account.encryptedPass,
      },
    });

    // Format the forwarded body (mimics Outlook/Gmail headers)
    const forwardedHeader = `
      <br/><br/>
      <hr style="border:none; border-top:1px solid #E1E1E1; margin:12px 0;">
      <div style="font-family: Calibri, sans-serif; font-size: 11pt; color: #000000;">
        <b>From:</b> ${original.fromName || original.fromEmail} &lt;${original.fromEmail}&gt;<br>
        <b>Sent:</b> ${new Date(original.sentAt).toLocaleString()}<br>
        <b>To:</b> ${original.toEmail}<br>
        ${original.ccEmail ? `<b>Cc:</b> ${original.ccEmail}<br>` : ""}
        <b>Subject:</b> ${original.subject}
      </div>
      <br/>
    `;

    const normalizedBody = normalizeEmailHtml(
      `${body || ""}${forwardedHeader}${original.bodyHtml || original.body || ""}`,
    );
    const msgId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@${authEmail.split("@")[1]}>`;
    const smtpFrom = senderName ? `"${senderName}" <${authEmail}>` : authEmail;

    await transporter.sendMail({
      from: smtpFrom,
      to: finalToList.join(", "),
      ...(finalCcList.length > 0 && { cc: finalCcList.join(", ") }),

      // 🛡️ ENVELOPE LOGIC: Guarantees delivery to the new recipients
      envelope: {
        from: authEmail,
        to: allRecipients,
      },

      subject: finalSubject,
      html: normalizedBody,
      text: htmlToText(normalizedBody, { wordwrap: 80 }),
      messageId: msgId,
      headers: {
        "X-Mailer": "Microsoft Outlook",
      },
      attachments: attachments.map((f) => ({
        filename: f.filename || f.name,
        path: f.url,
      })),
    });

    /* =====================================================
       6️⃣ SAVE MESSAGE
    ===================================================== */
    const saved = await prisma.emailMessage.create({
      data: {
        emailAccountId: Number(emailAccountId),
        conversationId: newConversationId,
        leadDetailId,
        messageId: msgId,
        fromEmail: authEmail,
        fromName: senderName,
        toEmail: finalToList.join(", "),
        ccEmail: finalCcList.join(", ") || null,
        subject: finalSubject,
        body: normalizedBody,
        direction: "sent",
        sentAt: new Date(),
        folder: "sent",
        isRead: true,
      },
    });

    return res.json({ success: true, data: saved });
  } catch (err) {
    console.error("❌ Forward error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});
/* ============================================================
   🔧 PATCH Routes
   ============================================================ */

/* ✅ PATCH: Mark Single Email as Read */
router.patch("/mark-read/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.emailMessage.update({
      where: { id: Number(id) },
      data: { isRead: true },
    });
    res.json({ success: true });
  } catch (err) {
    console.error("🔥 ERROR /inbox/conversations:", err);
    res.status(500).json({
      error: "Failed to load conversations",
      details: err.message,
    });
  }
});



/* 🔒 PATCH: Hide Message from Inbox */
router.patch("/hide-inbox/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    const msg = await prisma.emailMessage.update({
      where: { id },
      data: {
        hideInbox: true,
      },
    });

    return res.json({
      success: true,
      message: "Message hidden from inbox",
      data: msg,
    });
  } catch (err) {
    console.error("❌ hide-inbox failed:", err);
    return res.status(500).json({ success: false });
  }
});

/* 🗑️ PATCH: Hide Message from Trash */
router.patch("/hide-trash/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    const msg = await prisma.emailMessage.update({
      where: { id },
      data: {
        hideTrash: true,
      },
    });

    return res.json({
      success: true,
      message: "Message hidden from trash",
      data: msg,
    });
  } catch (err) {
    console.error("❌ hide-trash failed:", err);
    return res.status(500).json({ success: false });
  }
});

/* server/routes/inbox.js - Line 840 */

// PATCH /api/inbox/hide-inbox-conversation
router.patch("/hide-inbox-conversation", async (req, res) => {
  try {
    const { conversationId, accountId } = req.body;
    if (!conversationId || !accountId) {
      return res.status(400).json({ success: false });
    }

    // 🔍 get account safely
    const msg = await prisma.emailMessage.findFirst({
      where: {
        conversationId,
        emailAccountId: Number(accountId),
      },
      select: { emailAccountId: true },
    });

    if (!msg) {
      return res.status(404).json({ success: false });
    }

    // 🗑️ move messages to trash
    await prisma.emailMessage.updateMany({
      where: {
        conversationId,
        emailAccountId: Number(accountId),
      },
      data: {
        isTrash: true,
        hideInbox: true,
        hideTrash: false,
      },
    });

    // 🗑️ hide conversation
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        hideInbox: true,
        hideTrash: false,
      },
    });

    // 🔥 clear cache
    clearInboxCacheByAccount(msg.emailAccountId);

    res.json({ success: true });
  } catch (err) {
    console.error("❌ MOVE TO TRASH ERROR:", err);
    res.status(500).json({ success: false });
  }
});

// PATCH /api/inbox/restore-conversation
router.patch("/restore-conversation", async (req, res) => {
  try {
    const { conversationId, accountId } = req.body;
    if (!conversationId || !accountId) {
      return res.status(400).json({ success: false });
    }

    // 1️⃣ find any valid message (guard)
    const anyMsg = await prisma.emailMessage.findFirst({
      where: {
        conversationId,
        emailAccountId: Number(accountId),
        hideTrash: false,
      },
      select: { emailAccountId: true },
    });

    if (!anyMsg) {
      return res.status(400).json({
        success: false,
        message: "Conversation permanently deleted",
      });
    }

    // 2️⃣ 🔥 SAFELY decide restore target
    const spamCount = await prisma.emailMessage.count({
      where: {
        conversationId,
        emailAccountId: Number(accountId),
        isSpam: true,
        hideTrash: false,
      },
    });

    const restoreToSpam = spamCount > 0;

    // 3️⃣ restore messages
    await prisma.emailMessage.updateMany({
      where: {
        conversationId,
        emailAccountId: Number(accountId),
        hideTrash: false,
      },
      data: {
        isTrash: false,
        isTrash: false,
        hideInbox: false,
        hideTrash: false,
      },
    });

    // 4️⃣ restore conversation visibility
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        hideTrash: true,
        hideInbox: restoreToSpam ? true : false,
      },
    });

    // 5️⃣ clear cache
    clearInboxCacheByAccount(anyMsg.emailAccountId);

    res.json({ success: true });
  } catch (err) {
    console.error("❌ RESTORE CONVERSATION ERROR:", err);
    res.status(500).json({ success: false });
  }
});

router.patch("/permanent-delete-conversation", async (req, res) => {
  try {
    const { conversationId, accountId } = req.body;

    if (!conversationId || !accountId) {
      return res.status(400).json({ success: false });
    }

    // 1️⃣ Safety: get accountId from DB (never trust body blindly)
    const msg = await prisma.emailMessage.findFirst({
      where: {
        conversationId,
        emailAccountId: Number(accountId),
      },
      select: { emailAccountId: true },
    });

    if (!msg) {
      return res.status(404).json({ success: false });
    }

    // 2️⃣ Permanently hide ALL messages (FLAG ONLY)
    await prisma.emailMessage.updateMany({
      where: {
        conversationId,
        emailAccountId: Number(accountId),
      },
      data: {
        isTrash: true,
        hideInbox: true,
        hideTrash: true,
      },
    });

    // 3️⃣ 🔥 Permanently hide conversation itself
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        hideInbox: true,
        hideTrash: true,
      },
    });

    // 4️⃣ 🔥🔥🔥 CLEAR CACHE (CRITICAL)
    clearInboxCacheByAccount(msg.emailAccountId);

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ PERMANENT DELETE ERROR:", err);
    res.status(500).json({ success: false });
  }
});

router.post("/delete", async (req, res) => {
  try {
    const { conversationIds, folder } = req.body;

    if (!conversationIds?.length) {
      return res.status(400).json({ success: false });
    }

    if (folder === "trash") {
      // ✅ PERMANENT DELETE
      await prisma.emailMessage.updateMany({
        where: {
          conversationId: { in: conversationIds },
          isTrash: true,
          hideTrash: false,
        },
        data: {
          hideTrash: true,
        },
      });
    } else {
      // ✅ MOVE TO TRASH
      await prisma.emailMessage.updateMany({
        where: {
          conversationId: { in: conversationIds },
        },
        data: {
          isTrash: true,
          isSpam: false,
          hideInbox: true,
          folder: "trash",
        },
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE ERROR:", err);
    res.status(500).json({ success: false });
  }
});
router.post("/move-to-inbox", async (req, res) => {
  try {
    const { conversationIds, accountId } = req.body;

    if (!conversationIds?.length || !accountId) {
      return res.status(400).json({
        success: false,
        message: "Missing conversationIds or accountId",
      });
    }

    await prisma.emailMessage.updateMany({
      where: {
        conversationId: { in: conversationIds },
        emailAccountId: Number(accountId),
      },
      data: {
        folder: "inbox",
        isSpam: false,
        isTrash: false,
        hideInbox: false,
        hideTrash: false,
        // direction: "received", // 🔥 CRITICAL FIX
      },
    });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ MOVE TO INBOX ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Failed to move messages to inbox",
    });
  }
});

// ============================================================
// 🗑️ DELETE SINGLE MESSAGE (MOVE TO TRASH)
// ============================================================
router.post("/message/:messageId/trash", async (req, res) => {
  try {
    const messageId = Number(req.params.messageId);
    if (!messageId) {
      return res.status(400).json({ success: false });
    }

    // 1️⃣ Fetch message FIRST (for accountId + folder safety)
    const message = await prisma.emailMessage.findUnique({
      where: { id: messageId },
      select: {
        emailAccountId: true,
        folder: true,
        originalFolder: true,
      },
    });

    if (!message) {
      return res.status(404).json({ success: false });
    }

    // 2️⃣ Soft delete (FLAGS ONLY — rules preserved)
    await prisma.emailMessage.update({
      where: { id: messageId },
      data: {
        isTrash: true,
        hideInbox: true,
        hideTrash: false,
        originalFolder: message.originalFolder ?? message.folder,
      },
    });

    // 🔥🔥🔥 CRITICAL FIX
    clearInboxCacheByAccount(message.emailAccountId);

    return res.json({
      success: true,
      message: "Message moved to trash",
    });
  } catch (err) {
    console.error("❌ MESSAGE DELETE ERROR:", err);
    return res.status(500).json({ success: false });
  }
});

// ============================================================
// ♻️ RESTORE MESSAGE (SAFE)
// ============================================================
router.post("/message/:messageId/restore", async (req, res) => {
  try {
    const messageId = Number(req.params.messageId);
    if (!messageId) {
      return res.status(400).json({ success: false });
    }

    // 1️⃣ Fetch message state + accountId
    const message = await prisma.emailMessage.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        emailAccountId: true,
        isTrash: true,
        hideTrash: true,
      },
    });

    if (!message) {
      return res.status(404).json({ success: false });
    }

    // 🚫 BLOCK restoring permanently deleted messages
    if (message.isTrash && message.hideTrash) {
      return res.status(400).json({
        success: false,
        message: "Message permanently deleted",
      });
    }

    // 2️⃣ RESTORE (FLAG ONLY)
    await prisma.emailMessage.update({
      where: { id: messageId },
      data: {
        isTrash: false,
        hideInbox: false,
        hideTrash: false, // ✅ MUST be false
      },
    });

    // 3️⃣ CLEAR CACHE (🔥 FIX)
    clearInboxCacheByAccount(message.emailAccountId);

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ RESTORE ERROR:", err);
    return res.status(500).json({ success: false });
  }
});

// ============================================================
// 🔒 PERMANENT DELETE (FLAG-ONLY, NO ROW DELETION)
// ============================================================
router.delete("/message/:messageId/permanent", async (req, res) => {
  try {
    const messageId = Number(req.params.messageId);
    if (!messageId) {
      return res.status(400).json({
        success: false,
        message: "Invalid messageId",
      });
    }

    // 1️⃣ Fetch message to get accountId (needed for cache clear)
    const message = await prisma.emailMessage.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        emailAccountId: true,
      },
    });

    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Message not found",
      });
    }

    // 2️⃣ PERMANENT DELETE = FLAG ONLY
    await prisma.emailMessage.update({
      where: { id: messageId },
      data: {
        isTrash: true, // deleted
        hideInbox: true, // hide from Inbox / Sent / Spam
        hideTrash: true, // hide from Trash (permanent)
      },
    });

    // 3️⃣ CLEAR CACHE (🔥 REQUIRED)
    clearInboxCacheByAccount(message.emailAccountId);

    return res.json({
      success: true,
      message: "Message permanently deleted",
    });
  } catch (err) {
    console.error("❌ PERMANENT DELETE MESSAGE ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to permanently delete message",
    });
  }
});

//  🗑️ DELETE Routes

router.delete("/messages/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.emailMessage.delete({ where: { id: Number(id) } });
    res.json({ success: true, message: "Message deleted successfully" });
  } catch (err) {
    console.error("🔥 ERROR /inbox/conversations:", err);
    res.status(500).json({
      error: "Failed to load conversations",
      details: err.message,
    });
  }
});

export default router;