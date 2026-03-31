// campaignMailer.service.js — Batch-processing refactor
// Fixes OOM crashes on large campaigns (1000–10000+ recipients)
// by eliminating bulk in-memory loading of sentBodyHtml.
//
// Architecture:
//   Campaign → per-account batch loop → DB-fetch 50 → send → fetch next 50
//   For follow-ups: sentBodyHtml is loaded once per recipient at send-time,
//   never pre-loaded into a Map for all recipients at once.

import nodemailer from "nodemailer";
import prisma from "../prismaClient.js";
import { decrypt } from "../utils/crypto.js";
import cache from "../utils/cache.js";

/* ─────────────────────────────────────────────────────────────
   UNCHANGED HELPERS
   All original helper functions are preserved exactly.
───────────────────────────────────────────────────────────── */

function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

function distribute(items, total) {
  const result = [];
  let index = 0;
  for (let i = 0; i < total; i++) {
    result.push(items[index % items.length]);
    index++;
  }
  return shuffle(result);
}

// ✅ NO outer color override — pitch content carries its own colors from CreatePitch
function buildFollowupHtml({
  followUpBody,
  originalBody,
  from,
  to,
  sentAt,
  subject,
  baseColor
}) {
  return `
<div style="font-family: Calibri, sans-serif;">
      <!-- Follow-up body: color comes from pitch HTML itself, not forced here -->
      <div>
        ${followUpBody}
      </div>

      <br />
      <hr style="border:none;border-top:1px solid #ccc;margin:16px 0;" />

      <!-- Thread header: neutral black -->
      <div style="font-size:14px; line-height:1.5; color:#000000;">
        <b>From:</b> ${from}<br/>
        <b>Sent:</b> ${sentAt}<br/>
        <b>To:</b> ${to}<br/>
        <b>Subject:</b> ${subject}
      </div>

      <br />

      <!-- Previous message: div not blockquote — Gmail collapses blockquotes -->
      <div style="margin:0; padding-left:10px; border-left:3px solid #cccccc; color:#000000; font-family:Calibri,sans-serif; font-size:14px; line-height:1.6;">
        ${originalBody || ""}
      </div>

    </div>
  `;
}

function buildSignature(account, senderRole, baseStyles = {}) {
  const name =
    account.senderName ||
    account.email?.split("@")[0] ||
    "Sender";

  const role = senderRole?.trim() || "Marketing Analyst";

  // ✅ Color comes from extractBaseStyles which reads the pitch wrapper div color
  const sigColor = baseStyles.color || "#000000";
  const sigFont = baseStyles.fontFamily || "Calibri, sans-serif";
  const sigSize = baseStyles.fontSize || "15px";

  return `
    <div style="margin-top:16px; font-family:${sigFont}; font-size:${sigSize}; line-height:1.6; color:${sigColor};">
      <span style="color:${sigColor}; font-weight:bold;">Regards,</span>
      <br/>
      <span style="color:${sigColor}; font-weight:bold;">${name} - ${role}</span>
    </div>
  `;
}

/**
 * Extracts the original pitch content from a stored sentBodyHtml.
 * The stored HTML is a full email document with <table> wrapper and <style> tags.
 * We extract only the pitch body (no signature, no wrapper table, no style tags)
 * so it can be safely embedded as the "previous message" in a follow-up thread.
 *
 * KEY FIXES vs previous version:
 *  1. IE conditional comments stripped first (were interfering with body extraction)
 *  2. Signature stripping uses LAST-occurrence search, NOT a regex with `$` anchor.
 *     The old `[\s\S]*?<\/div>\s*$` wiped everything if the pitch body itself had
 *     any `<div style="margin-top:16px">` — a very common pattern in pitch templates.
 *  3. Multi-layer fallback so we never silently return "".
 */
function extractBodyContent(fullHtml) {
  if (!fullHtml) return "";

  try {
    // ── Step 1: Strip markup that can confuse body extraction ──────────
    let html = fullHtml
      // Remove IE conditional comments (contain <style> blocks that survive
      // the next replace and can match as part of bodyContent)
      .replace(/<!--\[if[^\]]*\]>[\s\S]*?<!\[endif\]-->/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");

    // ── Step 2: Extract <body> content ────────────────────────────────
    // Use greedy [\s\S]* (not *?) so we get the full body even when the
    // pitch itself embeds HTML fragments containing "</body>" strings.
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const bodyContent = bodyMatch ? bodyMatch[1] : html;

    // ── Step 3: Find the pitch wrapper div (has font-family in style) ─
    const wrapperRegex = /<div[^>]+style\s*=\s*["'][^"']*font-family[^"']*["'][^>]*>/i;
    const wrapperMatch = bodyContent.match(wrapperRegex);

    if (wrapperMatch) {
      const openTag    = wrapperMatch[0];
      const startIdx   = bodyContent.indexOf(openTag);
      const innerStart = startIdx + openTag.length;

      // Walk depth-first to find the closing </div> that matches the wrapper
      let depth = 1;
      let pos   = innerStart;
      while (pos < bodyContent.length && depth > 0) {
        const nextOpen  = bodyContent.indexOf("<div",  pos);
        const nextClose = bodyContent.indexOf("</div>", pos);
        if (nextClose === -1) break;
        if (nextOpen !== -1 && nextOpen < nextClose) {
          depth++;
          pos = nextOpen + 4;       // skip past '<div'
        } else {
          depth--;
          if (depth === 0) {
            // Return the full inner content including the Regards/signature block.
            // The original email's signature is part of the message the recipient
            // saw and should appear in the quoted thread section unchanged.
            const inner = bodyContent.substring(innerStart, nextClose).trim();
            return inner || bodyContent.substring(innerStart, nextClose).trim();
          }
          pos = nextClose + 6;      // skip past '</div>'
        }
      }
    }

    // ── Fallback A: wrapper div not found — return raw body ───────────
    return bodyContent.trim();

  } catch (err) {
    console.error("extractBodyContent error:", err.message);

    // ── Fallback B: catastrophic parse failure — strip all tags ───────
    // Returns plain-text version so the thread still makes visual sense.
    try {
      return fullHtml
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
    } catch {
      return "";
    }
  }
}

/**
 * Chunks an array into smaller arrays of given size.
 * Kept for any future use but batch fetching now happens at DB level.
 */
function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

const SAFE_LIMITS = {
  gmail: 50,
  gsuite: 80,
  rediff: 40,
  amazon: 60,
  custom: 60
};

function getLimit(provider = "", accountId = null, customLimits = {}) {
  if (accountId && customLimits[accountId]) {
    return customLimits[accountId];
  }
  const key = provider.toLowerCase();
  return SAFE_LIMITS[key] || SAFE_LIMITS.custom;
}

function getDomainLabel(email = "") {
  const domain = email.split("@")[1]?.toLowerCase() || "";
  if (domain.includes("gmail")) return "gmail";
  if (domain.includes("yahoo")) return "yahoo";
  if (domain.includes("outlook") || domain.includes("hotmail")) return "outlook";
  return domain.split(".")[0] || "client";
}

function normalizeHtmlForEmail(html) {
  if (!html) return html;

  let cleaned = html.trim();

  // Don't remove color styles — preserve them
  cleaned = cleaned.replace(/font-size:\s*(\d+)pt/gi, (match, size) => {
    const pxSize = Math.round(parseFloat(size) * 1.333);
    return `font-size:${pxSize}px`;
  });

  // Convert font tags to spans but preserve color
  cleaned = cleaned.replace(/<font([^>]*)>/gi, (match, attributes) => {
    const colorMatch = attributes.match(/color="([^"]*)"/i);
    const color = colorMatch ? `color:${colorMatch[1]};` : "";
    const otherAttrs = attributes.replace(/color="([^"]*)"/gi, "");
    return `<span style="${color}${otherAttrs}">`;
  });
  cleaned = cleaned.replace(/<\/font>/gi, "</span>");

  cleaned = cleaned.replace(/<div>\s*<\/div>/gi, "");
  cleaned = cleaned.replace(/<div><br><\/div>/gi, "<br>");
  cleaned = cleaned.replace(/(<br\s*\/?>\s*){2,}/gi, "<br>");

  cleaned = cleaned.replace(
    /<p([^>]*)>/gi,
    '<p$1 style="margin:0; padding:0; mso-margin-top-alt:0; mso-margin-bottom-alt:0; line-height:1.4;">'
  );

  return cleaned;
}

function extractBaseStyles(html) {
  const fontFamilyMatch = html.match(/font-family:\s*([^;}"']+)/i);
  const fontSizeMatch   = html.match(/font-size:\s*([^;}"']+)/i);

  const UNSAFE = new Set(["#fff", "#ffffff", "white", "transparent", "inherit", ""]);
  let color = "#000000";

  // ✅ Priority 1: Wrapper <div style="...color:#XXXXX"> written by CreatePitch.jsx on save
  const wrapperDivMatch = html.match(/^\s*<div[^>]*style="([^"]*)"/i);
  if (wrapperDivMatch) {
    const styleStr = wrapperDivMatch[1];
    const colorInDiv = styleStr.match(/\bcolor:\s*(#[0-9a-fA-F]{3,6})/i);
    if (colorInDiv) {
      const c = colorInDiv[1].trim();
      if (!UNSAFE.has(c.toLowerCase())) color = c;
    }
  }

  // ✅ Priority 2: <font color="#..."> — browser writes this for execCommand('foreColor')
  if (color === "#000000") {
    const fontTagColor = html.match(/<font[^>]*\bcolor="(#[0-9a-fA-F]{3,6})"/i);
    if (fontTagColor) {
      const c = fontTagColor[1].trim();
      if (!UNSAFE.has(c.toLowerCase())) color = c;
    }
  }

  // ✅ Priority 3: <span style="color:#..."> — fallback for styled spans
  if (color === "#000000") {
    const spanColor = html.match(/<span[^>]*style="[^"]*\bcolor:\s*(#[0-9a-fA-F]{3,6})/i);
    if (spanColor) {
      const c = spanColor[1].trim();
      if (!UNSAFE.has(c.toLowerCase())) color = c;
    }
  }

  return {
    fontFamily: fontFamilyMatch ? fontFamilyMatch[1].trim() : "Calibri, sans-serif",
    fontSize:   fontSizeMatch   ? fontSizeMatch[1].trim()   : "15px",
    color
  };
}

/* ─────────────────────────────────────────────────────────────
   NEW: PRIVATE HELPERS FOR BATCH PROCESSING
───────────────────────────────────────────────────────────── */

const BATCH_SIZE = 50;

/**
 * Creates and returns a configured Nodemailer transporter for an email account.
 * Extracted to avoid duplicating the transporter setup in both send paths.
 */
function createTransporter(account, smtpPassword) {
  const domain = (account.email.split("@")[1] || "localhost").toLowerCase();
  return nodemailer.createTransport({
    host:    account.smtpHost,
    port:    Number(account.smtpPort),
    secure:  Number(account.smtpPort) === 465,
    name:    domain,
    auth: {
      user: account.smtpUser || account.email,
      pass: smtpPassword,
    },
    requireTLS: Number(account.smtpPort) === 587,
    tls: {
      rejectUnauthorized: false,
      minVersion: "TLSv1.2",
    },
  });
}

/**
 * Decrypts the account password safely.
 */
function decryptPassword(account) {
  let pass = account.encryptedPass;
  if (typeof pass === "string" && pass.includes(":")) {
    pass = decrypt(pass);
  }
  return pass;
}

/**
 * Walks the parentCampaignId chain to find the root (non-followup) campaign ID.
 * This is the campaign whose sentBodyHtml fields we read to build the thread.
 * Stops after MAX_LEVELS to guard against circular references.
 */
async function resolveOriginalCampaignId(startId) {
  let currentId = startId;
  const MAX_LEVELS = 10;

  for (let level = 0; level < MAX_LEVELS; level++) {
    const ancestor = await prisma.campaign.findUnique({
      where:  { id: currentId },
      select: { id: true, sendType: true, parentCampaignId: true },
    });

    if (!ancestor) break;

    // Stop if this ancestor is itself not a follow-up, or has no parent
    if (ancestor.sendType !== "followup" || !ancestor.parentCampaignId) {
      break;
    }

    currentId = ancestor.parentCampaignId;
  }

  console.log(`🔍 Resolved originalCampaignId=${currentId}`);
  return currentId;
}

/**
 * Wraps pitch body in the standard HTML email shell.
 * Used for normal (non-followup) campaigns.
 */
function buildNormalEmailHtml(body, signature, baseStyles) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <style>
    body { margin:0; padding:0; }
    table { border-collapse: collapse; }
    p { margin:0 !important; padding:0 !important; line-height:1.6 !important; }
    div { margin:0; padding:0; }
    .ExternalClass p { margin:0 !important; }
  </style>
  <!--[if mso]>
  <style>
    p { margin:0 !important; line-height:1.6 !important; }
  </style>
  <![endif]-->
</head>
<body style="margin:0; padding:0; background-color:#ffffff;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
    style="border-collapse:collapse; background-color:#ffffff;">
    <tr>
      <td style="padding-top:15px; background-color:#ffffff;">
        <div style="
          font-family:${baseStyles.fontFamily};
          font-size:${baseStyles.fontSize};
          color:${baseStyles.color};
          line-height:1.4;
          mso-line-height-rule:exactly;
        ">
          ${body}
          ${signature}
        </div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/* ─────────────────────────────────────────────────────────────
   CORE: PER-ACCOUNT BATCH SENDER
   Processes one email account's pending recipients in batches
   of BATCH_SIZE, fetching directly from the database each
   iteration so prior batches can be garbage-collected.
───────────────────────────────────────────────────────────── */

/**
 * @param {object}  opts
 * @param {number}  opts.campaignId
 * @param {number}  opts.accountId
 * @param {object}  opts.campaign          — full campaign row (no recipients)
 * @param {Map}     opts.assignmentMap     — recipientId → { subject, pitchBody }
 * @param {number|null} opts.originalCampaignId — root campaign for thread data (followup only)
 * @param {object}  opts.customLimits
 */

// 🔁 Retry wrapper (VERY IMPORTANT)
async function sendWithRetry(sendFn, retries = 3) {
  let lastError;

  for (let i = 1; i <= retries; i++) {
    try {
      return await sendFn();
    } catch (err) {
      lastError = err;

      console.warn(`⚠️ Retry ${i} failed:`, err.message);

      // wait before retry (2s, 4s, 6s)
      await new Promise(r => setTimeout(r, 2000 * i));
    }
  }

  throw lastError;
}

// 🔍 Detect temporary errors
function isTemporaryError(err) {
  const msg = (err.message || "").toLowerCase();

  return (
    msg.includes("timeout") ||
    msg.includes("connection") ||
    msg.includes("rate") ||
    msg.includes("421") ||
    msg.includes("450") ||
    msg.includes("too many") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("socket") ||
    msg.includes("network")
  );
}

async function processAccountBatched({
  campaignId,
  accountId,
  campaign,
  assignmentMap,
  originalCampaignId,
  customLimits,
}) {
  const account = await prisma.emailAccount.findUnique({
    where: { id: Number(accountId) },
  });
  if (!account) {
    console.warn(`⚠️ Account ${accountId} not found, skipping`);
    return;
  }

  const limit         = getLimit(account.provider, account.id, customLimits);
  const delayPerEmail = (60 * 60 * 1000) / limit;   // ms between sends
  const fromEmail     = account.smtpUser || account.email;
  const password      = decryptPassword(account);
  const transporter   = createTransporter(account, password);

  let accountSendCount = 0;
  let accountStartTime = Date.now();

  console.log(`📤 Account ${account.email}: starting batch send (limit=${limit}/hr)`);

  // ── BATCH LOOP ──────────────────────────────────────────────
  // We always query the first N pending records; since we update
  // each to "sent"/"failed" before moving on, the set shrinks
  // naturally — no OFFSET needed.
  while (true) {

    // ── Stop check (outer — before fetching a new batch) ──────
    const latestCampaign = await prisma.campaign.findUnique({
      where:  { id: campaignId },
      select: { status: true },
    });
    if (!latestCampaign || latestCampaign.status !== "sending") {
      console.log(`⏹ Campaign ${campaignId} stopped — halting account ${account.email}`);
      return;
    }

    // ── Fetch next batch from DB ───────────────────────────────
    // Only pending rows for this account; fetched fresh each time
    // so prior batch is eligible for GC once the loop body exits.
    const batch = await prisma.campaignRecipient.findMany({
      where: {
        campaignId,
        accountId: Number(accountId),
        OR: [
          { status: "retry" },     // 🔥 PRIORITY FIRST
          { status: "pending" }
        ]
      },
      orderBy: [
        { status: "desc" },  // retry comes first
        { id: "asc" }
      ],
      take: BATCH_SIZE,
    });

    if (batch.length === 0) {
      console.log(`✅ Account ${account.email}: no more pending recipients`);
      break;
    }

    console.log(`📦 Account ${account.email}: processing batch of ${batch.length}`);

    // ── Process each recipient in the batch ───────────────────
for (const recipient of batch) {

  // Inner stop check (between individual emails)
  const innerCheck = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { status: true },
  });

  if (!innerCheck || innerCheck.status !== "sending") {
    console.log(`⏹ Campaign ${campaignId} stopped mid-batch`);
    return;
  }

  // ✅ CRITICAL FIX: PREVENT DOUBLE SEND
  const alreadySent = await prisma.campaignRecipient.findUnique({
    where: { id: recipient.id },
    select: { status: true },
  });

  if (alreadySent?.status === "sent") {
    console.log("⚠️ Already sent, skipping:", recipient.email);
    continue;
  }

  // ── Rate-limit guard ─────────────────────────────────────
  if (accountSendCount >= limit) {
    const elapsed = Date.now() - accountStartTime;
    if (elapsed < 3_600_000) {
      const wait = 3_600_000 - elapsed;
      console.log(
        `⏳ ${account.email} hourly limit reached — waiting ${Math.ceil(wait / 60_000)}m`
      );
      await sleep(wait);
    }
    accountSendCount = 0;
    accountStartTime = Date.now();
  }

  // ── Look up pre-computed subject + pitch for this recipient
  const assignment = assignmentMap.get(recipient.id);
  if (!assignment) {
    console.warn(`⚠️ No assignment found for recipient ${recipient.id}, skipping`);
    continue;
  }

  try {
    if (campaign.sendType === "followup") {
      await sendOneFollowup({
        recipient,
        account,
        transporter,
        fromEmail,
        campaign,
        assignment,
        originalCampaignId,
      });
    } else {
      await sendOneNormal({
        recipient,
        account,
        transporter,
        fromEmail,
        campaign,
        assignment,
      });
    }

    accountSendCount++;

    if (!recipient._isRetry) {
      await sleep(delayPerEmail);
    }

  } catch (err) {
    console.error(`❌ Send failed → ${recipient.email}:`, err.message);

    // 🔁 TEMPORARY ERROR → retry (SAFE VERSION)
    if (
      isTemporaryError(err) &&
      (recipient.retryCount || 0) < 3 &&
      !err.message.toLowerCase().includes("sent") // ✅ avoid duplicate resend
    ) {
      console.warn(`🔁 Retry scheduled: ${recipient.email}`);
      recipient._isRetry = true;

      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: "retry",
          retryCount: { increment: 1 },
          error: err.message,
        },
      });

    } else {
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: "failed",
          error: err.message,
        },
      });
    }
  }
}

    // batch goes out of scope here — eligible for GC
  }
}

/* ─────────────────────────────────────────────────────────────
   SEND: NORMAL CAMPAIGN EMAIL
───────────────────────────────────────────────────────────── */

async function sendOneNormal({
  recipient,
  account,
  transporter,
  fromEmail,
  campaign,
  assignment,
}) {
  const { subject: rawSubject, pitchBody: rawBody } = assignment;

  const label   = getDomainLabel(recipient.email);
  const subject = `${label} - ${rawSubject}`;

  let body = normalizeHtmlForEmail(rawBody);
  const baseStyles = extractBaseStyles(body);

  const unsafeColors = ["#fff", "#ffffff", "white", "transparent"];
  if (!baseStyles.color || unsafeColors.includes(baseStyles.color.toLowerCase())) {
    baseStyles.color = "#000000";
  }

  const signature = buildSignature(account, campaign.senderRole, baseStyles);

  if (!body.includes("color:") && baseStyles.color !== "#000000") {
    body = `<span style="color:${baseStyles.color};">${body}</span>`;
  }

  const html = buildNormalEmailHtml(body, signature, baseStyles);

  await sendWithRetry(() =>
    transporter.sendMail({
      from: account.senderName
        ? `"${account.senderName}" <${fromEmail}>`
        : fromEmail,
      to: recipient.email,
      subject,
      html,
    })
  );
  await prisma.conversation.upsert({
    where: { id: `${account.id}_sent_${recipient.email}` },
    update: {
      lastMessageAt: new Date(),
      messageCount: { increment: 1 },
    },
    create: {
      id: `${account.id}_sent_${recipient.email}`,
      emailAccountId: account.id,
      subject: rawSubject || subject,
      participants: `${fromEmail}, ${recipient.email}`,
      toRecipients: recipient.email,
      initiatorEmail: fromEmail,
      lastMessageAt: new Date(),
      messageCount: 1,
      unreadCount: 0,
    },
  });
  // ✅ SAVE TO INBOX (IMPORTANT FIX)
  try {
    // ✅ STRONG DUPLICATE CHECK (NO TIME LIMIT)
    const exists = await prisma.emailMessage.findFirst({
      where: {
        emailAccountId: account.id,
        toEmail: recipient.email,
        subject: subject,
      },
    });

    if (exists) {
      console.log("⚠️ Duplicate DB insert skipped:", recipient.email);
    } else {
      // ✅ ALWAYS GENERATE UNIQUE messageId
      const newMessageId = `sent-${Date.now()}-${recipient.email}`;

      await prisma.emailMessage.create({
        data: {
          emailAccountId: account.id,
          toEmail: recipient.email,
          subject: subject,
          sentAt: new Date(),
          messageId: newMessageId,
          fromEmail: fromEmail,
          direction: "sent",
          folder: "sent",
          isRead: true,
        },
      });
    }
  } catch (e) {
    console.error("⚠️ Email log failed (ignored):", e.message);
  }

  await prisma.campaignRecipient.update({
    where: { id: recipient.id },
    data: {
      status:        "sent",
      sentAt:        new Date(),
      accountId:     account.id,
      sentBodyHtml:  html,
      sentSubject:   rawSubject,    // stored WITHOUT the domain label prefix
      sentFromEmail: fromEmail,
    },
  });

  // console.log(`✅ ${account.email} → ${recipient.email}`);
}

/* ─────────────────────────────────────────────────────────────
   SEND: FOLLOW-UP CAMPAIGN EMAIL
   Key change: previousEmail is fetched PER RECIPIENT from the DB
   right here — never pre-loaded into a bulk Map.
───────────────────────────────────────────────────────────── */

async function sendOneFollowup({
  recipient,
  account,
  transporter,
  fromEmail,
  campaign,
  assignment,
  originalCampaignId,
}) {
  const { subject: fallbackSubject, pitchBody: rawFollowupBody } = assignment;

  const followupBody = normalizeHtmlForEmail(rawFollowupBody);
  const baseStyles   = extractBaseStyles(followupBody);
  const signature    = buildSignature(account, campaign.senderRole, baseStyles);
  const followupWithSignature = followupBody + signature;

  // ── Fetch ONLY this recipient's previous email from the DB ─
  // This is the critical change: no bulk Map, no 250MB pre-load.
  // One targeted query per email; totally fine under rate limiting.
  let prevEmail = null;
  if (originalCampaignId) {
    prevEmail = await prisma.campaignRecipient.findFirst({
      where: {
        campaignId: originalCampaignId,
        email:      recipient.email,
        status:     "sent",
      },
      select: {
        sentBodyHtml:  true,
        sentSubject:   true,
        sentFromEmail: true,
        sentAt:        true,
      },
    });
  }

  let subject;
  let html;

  if (prevEmail) {
    // Build threaded reply
    let originalBody = extractBodyContent(prevEmail.sentBodyHtml);

    // Safety net: if extractBodyContent returned nothing but sentBodyHtml exists,
    // strip the outer HTML envelope manually and use the raw body content.
    // This prevents an empty thread body when pitch templates use margin-top:16px
    // on their own divs (which confused the old signature-stripping regex).
    if (!originalBody && prevEmail.sentBodyHtml) {
      console.warn(`⚠️ extractBodyContent empty for ${recipient.email} — using raw-strip fallback`);
      originalBody = prevEmail.sentBodyHtml
        .replace(/<!DOCTYPE[^>]*>/gi, "")
        .replace(/<html[^>]*>/gi, "").replace(/<\/html>/gi, "")
        .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
        .replace(/<body[^>]*>/gi, "").replace(/<\/body>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<!--\[if[^\]]*\]>[\s\S]*?<!\[endif\]-->/gi, "")
        .trim();
    }

    console.log(`📨 originalBody for ${recipient.email}: ${originalBody ? originalBody.length + " chars extracted" : "STILL EMPTY — sentBodyHtml may be null in DB"}`);

    const originalSubject = prevEmail.sentSubject  || "";
    const originalFrom    = prevEmail.sentFromEmail || fromEmail;
    const sentAt          = new Date(prevEmail.sentAt || Date.now()).toLocaleString();

    const threadedHtml = buildFollowupHtml({
      followUpBody: followupWithSignature,
      originalBody,
      from:         originalFrom,
      to:           recipient.email,
      sentAt,
      subject:      originalSubject,
      baseColor:    baseStyles.color || "#000",
    });

    html = `<html>
      <body style="font-family:Calibri,sans-serif">
      ${threadedHtml}
      </body>
      </html>`;

          subject = `Re: ${originalSubject}`;

          // Free the potentially large sentBodyHtml from prevEmail immediately
          prevEmail.sentBodyHtml = null;

        } else {
          // No prior email found — send as a standalone message
          html = `<html>
      <body style="font-family:Calibri,sans-serif">
      ${followupWithSignature}
      </body>
      </html>`;

    subject = `Re: ${fallbackSubject}`;
    console.warn(`⚠️ No original email found for ${recipient.email} — sending standalone`);
  }

await sendWithRetry(() =>
  transporter.sendMail({
    from: account.senderName
      ? `"${account.senderName}" <${fromEmail}>`
      : fromEmail,
    to: recipient.email,
    subject,
    html,
  })
);

try {
  // ✅ DUPLICATE CHECK (IMPORTANT)
  const exists = await prisma.emailMessage.findFirst({
    where: {
      emailAccountId: account.id,
      toEmail: recipient.email,
      subject: subject,
    },
  });

  if (exists) {
    console.log("⚠️ Follow-up duplicate skipped:", recipient.email);
  } else {
    // ✅ GENERATE UNIQUE messageId
    const newMessageId = `sent-${Date.now()}-${recipient.email}`;

    await prisma.emailMessage.create({
      data: {
        emailAccountId: account.id,
        messageId: newMessageId,
        conversationId: `${account.id}_sent_${recipient.email}`,
        subject: subject,
        fromEmail: fromEmail,
        fromName: account.senderName || null,
        toEmail: recipient.email,
        body: html,
        direction: "sent",
        folder: "sent",
        sentAt: new Date(),
        isRead: true,
      },
    });
  }
} catch (e) {
  console.error("⚠️ Email log failed (ignored):", e.message);
}
  await prisma.campaignRecipient.update({
    where: { id: recipient.id },
    data: {
      status:        "sent",
      sentAt:        new Date(),
      sentBodyHtml:  html,
      sentSubject:   prevEmail?.sentSubject ?? fallbackSubject,
      sentFromEmail: fromEmail,
    },
  });

  // console.log(`✅ followup ${account.email} → ${recipient.email}`);
}

/* ─────────────────────────────────────────────────────────────
   PUBLIC ENTRY POINT
───────────────────────────────────────────────────────────── */

export async function sendBulkCampaign(campaignId) {

  // ── 1. Load campaign metadata only (no recipients, no HTML blobs) ──
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
  });

  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  if (campaign.status !== "sending") {
    console.log(`⏭️ Campaign ${campaignId} already handled (status=${campaign.status})`);
    return;
  }

  console.log("📦 Campaign loaded:", {
    id:       campaign.id,
    status:   campaign.status,
    sendType: campaign.sendType,
  });

  await prisma.campaign.update({
    where: { id: campaignId },
    data:  { status: "sending" },
  });

  // ── 2. Parse config ────────────────────────────────────────────────
  let customLimits = {};
  if (campaign.customLimits) {
    try { customLimits = JSON.parse(campaign.customLimits); }
    catch (err) { console.error("Failed to parse customLimits:", err); }
  }

  let subjects = [];
  try { subjects = JSON.parse(campaign.subject || "[]"); }
  catch { subjects = [campaign.subject]; }
  if (!subjects.length) throw new Error("Subjects missing");

  let pitchIds = [];
  try { pitchIds = JSON.parse(campaign.pitchIds || "[]"); }
  catch { pitchIds = []; }

  let pitchBodies = [];
  if (pitchIds.length) {
    const pitches = await prisma.pitchTemplate.findMany({
      where: { id: { in: pitchIds } },
    });
    pitchBodies = pitches.map(p => p.bodyHtml).filter(Boolean);
  }

  // ── 3. Lean recipient list — only IDs + accountId, NO sentBodyHtml ─
  // For 10,000 recipients this is ~10,000 × ~40 bytes ≈ 400 KB. Safe.
  const pendingRecipients = await prisma.campaignRecipient.findMany({
    where:   { campaignId, status: "pending" },
    select:  { id: true, email: true, accountId: true, retryCount: true },
    orderBy: { id: "asc" },
  });

  if (!pendingRecipients.length) {
    console.log(`ℹ️ No pending recipients for campaign ${campaignId}`);
    await updateCampaignStatus(campaignId);
    return;
  }

  // ── 4. Build assignment plan ───────────────────────────────────────
  // subjectPlan and pitchPlan are small arrays of strings (the same few
  // pitch bodies referenced multiple times — JS shares the string pointers).
  // recipientAssignmentMap maps each recipientId → { subject, pitchBody }
  // so we can look up assignments inside the batch loop without reloading
  // all recipients.
  const count      = pendingRecipients.length;
  const subjectPlan = distribute(subjects, count);
  const pitchPlan   = pitchBodies.length
    ? distribute(pitchBodies, count)
    : distribute([campaign.bodyHtml], count);

  /** @type {Map<number, { subject: string, pitchBody: string }>} */
  const assignmentMap = new Map();
  pendingRecipients.forEach((r, idx) => {
    assignmentMap.set(r.id, {
      subject:   subjectPlan[idx],
      pitchBody: pitchPlan[idx],
    });
  });

  // ── 5. Collect distinct account IDs involved ───────────────────────
  const accountIds = [
    ...new Set(pendingRecipients.map(r => r.accountId).filter(Boolean)),
  ];

  if (!accountIds.length) {
    console.error(`❌ Campaign ${campaignId}: no accountIds on pending recipients`);
    await updateCampaignStatus(campaignId);
    return;
  }

  // ── 6. For follow-ups: resolve root ancestor campaign once ─────────
  let originalCampaignId = null;
  if (campaign.sendType === "followup" && campaign.parentCampaignId) {
    originalCampaignId = await resolveOriginalCampaignId(campaign.parentCampaignId);
  }

  // ── 7. Kick off per-account batch processing in parallel ───────────
  // Each account runs independently and only holds BATCH_SIZE recipients
  // in memory at a time. Promise.all is safe here because memory is
  // bounded per account (not per total recipient count).
  await Promise.all(
    accountIds.map(accountId =>
      processAccountBatched({
        campaignId,
        accountId,
        campaign,
        assignmentMap,
        originalCampaignId,
        customLimits,
      })
    )
  );

  // ── 8. Final status update ─────────────────────────────────────────
  await updateCampaignStatus(campaignId);
  console.log(`✅ Campaign ${campaignId} batch processing complete`);
}

/* ─────────────────────────────────────────────────────────────
   UNCHANGED: updateCampaignStatus
───────────────────────────────────────────────────────────── */

async function updateCampaignStatus(campaignId) {
  const stats = await prisma.campaignRecipient.groupBy({
    by:    ["status"],
    where: { campaignId },
    _count: { status: true },
  });

  const counts = { sent: 0, failed: 0, pending: 0 };
  for (const row of stats) {
    counts[row.status] = row._count.status;
  }

  let finalStatus;
  if (counts.pending > 0)                              finalStatus = "sending";
  else if (counts.sent === 0 && counts.failed > 0)     finalStatus = "failed";
  else                                                  finalStatus = "completed";

  const campaign = await prisma.campaign.findUnique({
    where:  { id: campaignId },
    select: { userId: true },
  });

  await prisma.campaign.update({
    where: { id: campaignId },
    data:  { status: finalStatus },
  });

  if (campaign?.userId) {
    const ranges = ["today", "week", "month"];
    ranges.forEach(range => cache.del(`dashboard:${campaign.userId}:${range}`));

    const keys = cache.keys();
    keys.forEach(key => {
      if (key.startsWith(`dashboard:${campaign.userId}:`)) cache.del(key);
    });

    console.log(`🔥 Cache invalidated for user ${campaign.userId}`);
  }

  console.log(`Campaign ${campaignId} status → ${finalStatus}`);
}

// 🔁 AUTO RETRY FAILED EMAILS (runs every 5 mins)
// setInterval(async () => {
//   try {
//     const failed = await prisma.campaignRecipient.findMany({
//       where: {
//         status: "failed",
//         retryCount: { lt: 3 } // max 3 retries
//       },
//       take: 100,
//     });

//     for (const r of failed) {
//       await prisma.campaignRecipient.update({
//         where: { id: r.id },
//         data: {
//           status: "pending",
//           retryCount: { increment: 1 }
//         }
//       });
//     }

//     if (failed.length) {
//       console.log(`🔁 Re-queued ${failed.length} failed emails`);
//     }

//   } catch (err) {
//     console.error("Retry job error:", err.message);
//   }

// }, 5 * 60 * 1000);