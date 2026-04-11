// campaignMailer.service.js — Batch-processing refactor + Global Daily Limit (5 PM reset)

import nodemailer from "nodemailer";
import prisma from "../prismaClient.js";
import { decrypt } from "../utils/crypto.js";
import cache from "../utils/cache.js";
import dns from "dns/promises";


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 1 — GLOBAL DAILY LIMIT HELPERS
   ─────────────────────────────────────────────────────────────────────────
   Business rules:
   • Max 5 000 emails per user per "day"
   • A "day" starts at 17:00 (5 PM) and ends at 16:59:59 the following day
   • Emails are only delivered between 17:00 → 04:59 (5 PM → 5 AM)
   • Outside that window the sender pauses and polls until 17:00 resumes
═══════════════════════════════════════════════════════════════════════════ */

const DAILY_LIMIT = 5000;

/**
 * Returns a stable Redis key for the current "day bucket".
 *
 * The bucket starts at 17:00 local time.  Any send before 17:00 belongs to
 * the bucket that STARTED the previous calendar day at 17:00.
 *
 * Examples (local clock):
 *   10:00 on Jan 15  →  key uses Jan 14  (bucket started 17:00 Jan 14)
 *   18:00 on Jan 15  →  key uses Jan 15  (bucket started 17:00 Jan 15)
 *
 * @param {number|string} userId
 * @returns {string}
 */
export function getTodayKey(userId) {
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
  );

  // The reset boundary for TODAY
  const resetToday = new Date(now);
  resetToday.setHours(17, 0, 0, 0);

  // If we haven't reached today's 17:00, the active bucket started yesterday
  const bucketStart = now < resetToday
    ? new Date(resetToday.getTime() - 86_400_000)   // yesterday's 17:00
    : resetToday;                                    // today's 17:00

  const dateLabel = bucketStart.toISOString().split("T")[0]; // "YYYY-MM-DD"
  return `mail_limit:${userId}:${dateLabel}`;

}


function getTodayStart() {
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
  );

  const resetToday = new Date(now);
  resetToday.setHours(17, 0, 0, 0);

  const start =
    now < resetToday
      ? new Date(resetToday.getTime() - 24 * 60 * 60 * 1000)
      : resetToday;

  // 🔥 CRITICAL FIX (normalize completely)
  start.setMilliseconds(0);

  return start;
}

/**
 * Fetch how many emails this user has sent in the current bucket.
 * @param {number|string} userId
 * @returns {Promise<number>}
 */
export async function getDailyCount(userId) {

  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
  );

  const resetToday = new Date(now);
  resetToday.setHours(17, 0, 0, 0);

  const start =
    now < resetToday
      ? new Date(resetToday.getTime() - 24 * 60 * 60 * 1000)
      : resetToday;

  const result = await prisma.dailyEmailLog.aggregate({
    _sum: {
      count: true,
    },
    where: {
      userId,
      sentAt: {
        gte: start,
      },
    },
  });

  return result._sum.count || 0;
}
/**
 * Atomically increment the per-user daily counter after a successful send.
 * TTL is 25 hours — generous enough to outlast any bucket, cleaned up by Redis.
 *
 * @param {number|string} userId
 * @returns {Promise<number>} new counter value
 */
// export async function incrementDailyCount(userId) {
//   const key = getTodayKey(userId);
//   const current = Number(await cache.get(key)) || 0;
//   const next = current + 1;
//   // node-cache / ioredis both accept ttl as 3rd arg (seconds)
//   await cache.set(key, next, 90_000); // 25 hours in seconds
//   return next;
// }

/**
 * Returns true when the current local time falls inside the allowed
 * sending window: 17:00 → 04:59 (5 PM to 5 AM).
 *
 * @returns {boolean}
 */
// export function isWithinSendingWindow() {
//   const hour = new Date().getHours();
//   return hour >= 17 || hour < 5;
// }

/**
 * Returns the number of milliseconds until the next 17:00 (5 PM).
 * Used to sleep the sender when it is outside the allowed window.
 *
 * @returns {number} milliseconds
 */
export function msUntilNextWindow() {
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
  );
  const next = new Date(now);
  next.setHours(17, 0, 0, 0);
  if (now >= next) next.setDate(next.getDate() + 1); // already past 17:00 → next day
  return next.getTime() - now.getTime();
}

/**
 * Block execution until the next sending window opens (next 17:00).
 * Logs a human-readable wait time.
 */

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 2 — UNCHANGED UTILITY HELPERS
═══════════════════════════════════════════════════════════════════════════ */

async function getSmtpIp(host) {
  try {
    const result = await dns.lookup(host);
    return result.address;
  } catch {
    return "unknown";
  }
}

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
      <div>
        ${followUpBody}
      </div>

      <br />
      <hr style="border:none;border-top:1px solid #ccc;margin:16px 0;" />

      <div style="font-size:14px; line-height:1.5; color:#000000;">
        <b>From:</b> ${from}<br/>
        <b>Sent:</b> ${sentAt}<br/>
        <b>To:</b> ${to}<br/>
        <b>Subject:</b> ${subject}
      </div>

      <br />

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
  const sigColor  = baseStyles.color      || "#000000";
  const sigFont   = baseStyles.fontFamily || "Calibri, sans-serif";
  const sigSize   = baseStyles.fontSize   || "15px";

  return `
    <div style="margin-top:16px; font-family:${sigFont}; font-size:${sigSize}; line-height:1.6; color:${sigColor};">
      <span style="color:${sigColor}; font-weight:bold;">Regards,</span>
      <br/>
      <span style="color:${sigColor}; font-weight:bold;">${name} - ${role}</span>
    </div>
  `;
}

function extractBodyContent(fullHtml) {
  if (!fullHtml) return "";

  try {
    let html = fullHtml
      .replace(/<!--\[if[^\]]*\]>[\s\S]*?<!\[endif\]-->/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");

    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const bodyContent = bodyMatch ? bodyMatch[1] : html;

    const wrapperRegex = /<div[^>]+style\s*=\s*["'][^"']*font-family[^"']*["'][^>]*>/i;
    const wrapperMatch = bodyContent.match(wrapperRegex);

    if (wrapperMatch) {
      const openTag    = wrapperMatch[0];
      const startIdx   = bodyContent.indexOf(openTag);
      const innerStart = startIdx + openTag.length;

      let depth = 1;
      let pos   = innerStart;
      while (pos < bodyContent.length && depth > 0) {
        const nextOpen  = bodyContent.indexOf("<div",  pos);
        const nextClose = bodyContent.indexOf("</div>", pos);
        if (nextClose === -1) break;
        if (nextOpen !== -1 && nextOpen < nextClose) {
          depth++;
          pos = nextOpen + 4;
        } else {
          depth--;
          if (depth === 0) {
            const inner = bodyContent.substring(innerStart, nextClose).trim();
            return inner || bodyContent.substring(innerStart, nextClose).trim();
          }
          pos = nextClose + 6;
        }
      }
    }

    return bodyContent.trim();

  } catch (err) {
    console.error("extractBodyContent error:", err.message);
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
  gmail:  50,
  gsuite: 80,
  rediff: 40,
  amazon: 60,
  custom: 60,
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
  if (domain.includes("gmail"))   return "gmail";
  if (domain.includes("yahoo"))   return "yahoo";
  if (domain.includes("outlook") || domain.includes("hotmail")) return "outlook";
  return domain.split(".")[0] || "client";
}

function normalizeHtmlForEmail(html) {
  if (!html) return html;

  let cleaned = html.trim();

  cleaned = cleaned.replace(/font-size:\s*(\d+)pt/gi, (match, size) => {
    const pxSize = Math.round(parseFloat(size) * 1.333);
    return `font-size:${pxSize}px`;
  });

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

  const wrapperDivMatch = html.match(/^\s*<div[^>]*style="([^"]*)"/i);
  if (wrapperDivMatch) {
    const styleStr = wrapperDivMatch[1];
    const colorInDiv = styleStr.match(/\bcolor:\s*(#[0-9a-fA-F]{3,6})/i);
    if (colorInDiv) {
      const c = colorInDiv[1].trim();
      if (!UNSAFE.has(c.toLowerCase())) color = c;
    }
  }

  if (color === "#000000") {
    const fontTagColor = html.match(/<font[^>]*\bcolor="(#[0-9a-fA-F]{3,6})"/i);
    if (fontTagColor) {
      const c = fontTagColor[1].trim();
      if (!UNSAFE.has(c.toLowerCase())) color = c;
    }
  }

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
    color,
  };
}

const BATCH_SIZE = 50;

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

function decryptPassword(account) {
  let pass = account.encryptedPass;
  if (typeof pass === "string" && pass.includes(":")) {
    pass = decrypt(pass);
  }
  return pass;
}

async function resolveOriginalCampaignId(startId) {
  let currentId = startId;
  const MAX_LEVELS = 10;

  for (let level = 0; level < MAX_LEVELS; level++) {
    const ancestor = await prisma.campaign.findUnique({
      where:  { id: currentId },
      select: { id: true, sendType: true, parentCampaignId: true },
    });

    if (!ancestor) break;

    if (ancestor.sendType !== "followup" || !ancestor.parentCampaignId) {
      break;
    }

    currentId = ancestor.parentCampaignId;
  }

  console.log(`🔍 Resolved originalCampaignId=${currentId}`);
  return currentId;
}

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


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 3 — RETRY / ERROR HELPERS  (unchanged)
═══════════════════════════════════════════════════════════════════════════ */

async function sendWithRetry(sendFn, retries = 1) {
  let lastError;
  for (let i = 1; i <= retries; i++) {
    try {
      return await sendFn();
    } catch (err) {
      lastError = err;
      console.warn(`⚠️ Retry ${i} failed:`, err.message);
      await new Promise(r => setTimeout(r, 2000 * i));
    }
  }
  throw lastError;
}

function isTemporaryError(err) {
  const msg = (err.message || "").toLowerCase();
  if (msg.includes("daily user sending limit exceeded")) return false;
  return (
    msg.includes("timeout")    ||
    msg.includes("connection") ||
    msg.includes("rate")       ||
    msg.includes("421")        ||
    msg.includes("450")        ||
    msg.includes("too many")   ||
    msg.includes("econnreset") ||
    msg.includes("etimedout")  ||
    msg.includes("socket")     ||
    msg.includes("network")
  );
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 4 — PER-ACCOUNT BATCH PROCESSOR  (daily limit + window injected)
═══════════════════════════════════════════════════════════════════════════ */

/**
 * @param {object}      opts
 * @param {number}      opts.campaignId
 * @param {number}      opts.accountId
 * @param {object}      opts.campaign          — full campaign row
 * @param {Map}         opts.assignmentMap     — recipientId → { subject, pitchBody }
 * @param {number|null} opts.originalCampaignId
 * @param {object}      opts.customLimits
 * @param {number}      opts.userId            — owner of the campaign (for daily counter)
 */
async function processAccountBatched({
  campaignId,
  accountId,
  campaign,
  assignmentMap,
  originalCampaignId,
  customLimits,
  userId,          // ← NEW: passed in from sendBulkCampaign
}) {
  const account = await prisma.emailAccount.findUnique({
    where: { id: Number(accountId) },
  });

  if (!account || !account.smtpUser) {
    console.error(`❌ Invalid account for sending: ${accountId}`);
    return;
  }

  const limit         = getLimit(account.provider, account.id, customLimits);
  const delayPerEmail = Math.floor((60 * 60 * 1000) / limit); // ms between emails to honour limit/hr
  const fromEmail     = account.smtpUser || account.email;
  const password      = decryptPassword(account);
  const transporter   = createTransporter(account, password);
  const smtpIp        = await getSmtpIp(account.smtpHost);

  console.log("📡 SMTP HOST:", account.smtpHost);
  console.log("🌐 RESOLVED IP:", smtpIp);
  console.log("📧 SENDING FROM:", account.email);

  let accountSendCount = 0;
  let accountStartTime = Date.now();

  console.log(`📤 Account ${account.email}: starting batch send (limit=${limit}/hr, delay=${Math.round(delayPerEmail/1000)}s per email)`);

  while (true) {

    // ── [A] Campaign stop check (outer) ────────────────────────────────
    const latestCampaign = await prisma.campaign.findUnique({
      where:  { id: campaignId },
      select: { status: true },
    });
    if (!latestCampaign || latestCampaign.status !== "sending") {
      console.log(`⏹ Campaign ${campaignId} stopped — halting account ${account.email}`);
      return;
    }

    // ── [B] Global sending-window check (outer) ─────────────────────────
    //    If we are outside 5 PM–5 AM, park here until the window opens.
    //    We re-check the campaign status after waking up in case it was
    //    stopped while we were sleeping.
    // if (!isWithinSendingWindow()) {
    //   await waitForSendingWindow();
    //   // Re-check campaign alive after the sleep
    //   const afterSleep = await prisma.campaign.findUnique({
    //     where:  { id: campaignId },
    //     select: { status: true },
    //   });
    //   if (!afterSleep || afterSleep.status !== "sending") {
    //     console.log(`⏹ Campaign ${campaignId} stopped during window-wait — halting.`);
    //     return;
    //   }
    // }

    // ── [C] Global daily-limit check (outer, before fetching a batch) ───
    const dailyCount = await getDailyCount(userId);
    if (dailyCount >= DAILY_LIMIT) {
      console.log(`🚫 Daily limit reached. Waiting for reset...`);

      const waitMs = msUntilNextWindow();
      const waitMin = Math.ceil(waitMs / 60000);

      console.log(`⏳ Sleeping ${waitMin} minutes until 5 PM reset`);

      await sleep(waitMs);

      console.log(`🔄 Resuming campaign after reset...`);
      continue; // ✅ resume loop
    }

    // ── [D] Fetch next batch ─────────────────────────────────────────────
    const batch = await prisma.campaignRecipient.findMany({
      where: {
        campaignId,
        accountId: Number(accountId),
        OR: [
            { status: "pending" },
            { status: "processing" } // ✅ ADD THIS
          ],
      },
      orderBy: [
        { status: "desc" },       // retry before pending
        { id: "asc" },
      ],
      take: BATCH_SIZE,
    });

    if (batch.length === 0) {
      console.log(`✅ Account ${account.email}: no more pending recipients`);
      break;
    }

    console.log(`📦 Account ${account.email}: processing batch of ${batch.length}`);
 
    for (const recipient of batch) {

      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: "processing",
        
        },
      });

      const fresh = await prisma.campaignRecipient.findUnique({
        where: { id: recipient.id },
        select: { status: true },
      });

      if (fresh.status !== "processing") continue;
      // ── [E] Campaign stop check (inner) ──────────────────────────────
      const innerCheck = await prisma.campaign.findUnique({
        where:  { id: campaignId },
        select: { status: true },
      });
      if (!innerCheck || innerCheck.status !== "sending") {
        console.log(`⏹ Campaign ${campaignId} stopped mid-batch`);
        return;
      }

      // ── [F] Sending-window check (inner — catches window expiry mid-batch)
      // if (!isWithinSendingWindow()) {
      //   console.log(`🌙 Sending window closed mid-batch. Pausing after ${recipient.email}.`);
      //   await waitForSendingWindow();
      //   // Re-check campaign after wake
      //   const afterSleep = await prisma.campaign.findUnique({
      //     where:  { id: campaignId },
      //     select: { status: true },
      //   });
      //   if (!afterSleep || afterSleep.status !== "sending") {
      //     console.log(`⏹ Campaign ${campaignId} stopped during window-wait (inner). Halting.`);
      //     return;
      //   }
      // }

      // ── [G] Daily limit check (inner — per-email, belt-and-suspenders) ─
      let currentCount = await getDailyCount(userId);
      if (currentCount >= DAILY_LIMIT) {
        console.log(`🚫 Limit hit mid-batch, waiting...`);

        const waitMs = msUntilNextWindow();
        await sleep(waitMs);

        console.log(`🔄 Resuming after reset`);
        continue;
      }

      // ── [H] Skip already-sent recipient ──────────────────────────────
      const alreadySent = await prisma.campaignRecipient.findUnique({
        where:  { id: recipient.id },
        select: { status: true },
      });
      if (alreadySent?.status === "sent") {
        console.log("⚠️ Already sent, skipping:", recipient.email);
        continue;
      }

      // ── [I] Provider hourly rate-limit guard (unchanged) ─────────────
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

      const assignment = assignmentMap.get(recipient.id);
      if (!assignment) {
        console.warn(`⚠️ No assignment found for recipient ${recipient.id}, skipping`);
        continue;
      }

      // ── [J] Send ──────────────────────────────────────────────────────
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
            smtpIp,
          });
        }

        // ── [K] Increment BOTH provider counter and global daily counter ─
        accountSendCount++;
        // await incrementDailyCount(userId);

        const newDailyTotal = await getDailyCount(userId);
        console.log(`📊 Daily sent: ${newDailyTotal}/${DAILY_LIMIT} (user ${userId})`);

        // Enforce the user-selected hourly rate limit (e.g. 60/hr = 60 000 ms delay)
        await sleep(delayPerEmail);

     } catch (err) {
      console.error(`❌ Send failed → ${recipient.email}:`, err.message);

      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: "failed",
          error: err.message,
        },
      });
    }
    } // end for (recipient of batch)
  } // end while (true)
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 5 — sendOneNormal  (unchanged)
═══════════════════════════════════════════════════════════════════════════ */

async function sendOneNormal({
  recipient,
  account,
  transporter,
  fromEmail,
  campaign,
  assignment,
  smtpIp,
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

  await Promise.race([
    sendWithRetry(() =>
      transporter.sendMail({
        from: account.senderName
          ? `"${account.senderName}" <${fromEmail}>`
          : fromEmail,
        to: recipient.email,
        subject,
        html,
      })
    ),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Hard Timeout")), 20000) // 20 sec max
    )
  ]);

  await prisma.conversation.upsert({
    where:  { id: `${account.id}_sent_${recipient.email}` },
    update: {
      lastMessageAt: new Date(),
      messageCount:  { increment: 1 },
    },
    create: {
      id:             `${account.id}_sent_${recipient.email}`,
      emailAccountId: account.id,
      subject:        rawSubject || subject,
      participants:   `${fromEmail}, ${recipient.email}`,
      toRecipients:   recipient.email,
      initiatorEmail: fromEmail,
      lastMessageAt:  new Date(),
      messageCount:   1,
      unreadCount:    0,
    },
  });

  try {
    const exists = await prisma.emailMessage.findFirst({
      where: {
        emailAccountId: account.id,
        toEmail:        recipient.email,
        subject:        subject,
      },
    });

    if (exists) {
      console.log("⚠️ Duplicate DB insert skipped:", recipient.email);
    } else {
      const newMessageId = `sent-${Date.now()}-${recipient.email}`;

      await prisma.emailMessage.create({
        data: {
          emailAccountId: account.id,
          toEmail:        recipient.email,
          subject:        subject,
          sentAt:         new Date(),
          messageId:      newMessageId,
          fromEmail:      fromEmail,
          direction:      "sent",
          folder:         "sent",
          isRead:         true,
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
      sentSubject:   rawSubject,
      sentFromEmail: fromEmail,
      sendingIp:     smtpIp,
    },
  });
  await prisma.dailyEmailLog.upsert({
    where: {
      userId_sentAt: {
        userId: campaign.userId,
        sentAt: getTodayStart(), // 👈 important
      },
    },
    update: {
      count: {
        increment: 1,
      },
    },
    create: {
      userId: campaign.userId,
      userName: campaign.user?.name || "Unknown",
      empId: campaign.user?.empId || "N/A",
      count: 1,
      sentAt: getTodayStart(),
    },
  });
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 6 — sendOneFollowup  (unchanged)
═══════════════════════════════════════════════════════════════════════════ */

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
  if (!followupBody || followupBody.trim() === "") {
    throw new Error("Follow-up body is empty");
  }
  const baseStyles            = extractBaseStyles(followupBody);
  const signature             = buildSignature(account, campaign.senderRole, baseStyles);
  const followupWithSignature = followupBody + signature;

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

  if (!prevEmail) {
    console.warn(`❌ No original email record: ${recipient.email}`);
    await prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data:  { status: "failed", error: "No original email found" },
    });
    return;
  }

  let originalBody = extractBodyContent(prevEmail.sentBodyHtml);

  if (!originalBody) {
    console.warn(`⚠️ extractBodyContent empty for ${recipient.email} — using raw fallback`);
    originalBody = prevEmail.sentBodyHtml
      .replace(/<!DOCTYPE[^>]*>/gi, "")
      .replace(/<html[^>]*>/gi, "").replace(/<\/html>/gi, "")
      .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
      .replace(/<body[^>]*>/gi, "").replace(/<\/body>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<!--\[if[^\]]*\]>[\s\S]*?<!\[endif\]-->/gi, "")
      .trim();
  }

  console.log(
    `📨 originalBody for ${recipient.email}: ${
      originalBody ? originalBody.length + " chars extracted" : "EMPTY"
    }`
  );

  const originalSubject = prevEmail.sentSubject  || fallbackSubject || "";
  const originalFrom    = prevEmail.sentFromEmail || fromEmail;
  const sentAt          = new Date(prevEmail.sentAt || Date.now()).toLocaleString();

  const threadedHtml = buildFollowupHtml({
    followUpBody: followupWithSignature,
    originalBody,
    from:      originalFrom,
    to:        recipient.email,
    sentAt,
    subject:   originalSubject,
    baseColor: baseStyles.color || "#000",
  });

  const html = `<html>
    <body style="font-family:Calibri,sans-serif">
      ${threadedHtml}
    </body>
  </html>`;

  const subject = originalSubject ? `Re: ${originalSubject}` : `Re: ${fallbackSubject}`;

  prevEmail.sentBodyHtml = null; // free memory

  const originalAccountRef = await prisma.campaignRecipient.findFirst({
    where: {
      campaignId: originalCampaignId,
      email:      recipient.email,
      status:     "sent",
    },
    select: { accountId: true },
  });

  const accountToUse  = originalAccountRef?.accountId || account.id;
  const actualAccount = await prisma.emailAccount.findUnique({
    where: { id: accountToUse },
  });

  if (!actualAccount || !actualAccount.smtpHost) {
    console.error(`❌ Follow-up skipped (account ${accountToUse} not found): ${recipient.email}`);
    await prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data:  { status: "failed", error: `SMTP account ${accountToUse} not found` },
    });
    return;
  }

  const actualPassword    = decryptPassword(actualAccount);
  const actualTransporter = createTransporter(actualAccount, actualPassword);
  const actualFromEmail   = actualAccount.smtpUser || actualAccount.email;

  const prevEmailMsg = await prisma.emailMessage.findFirst({
    where:   { emailAccountId: actualAccount.id, toEmail: recipient.email },
    orderBy: { sentAt: "asc" },
    select:  { messageId: true },
  });

  const threadingHeaders = prevEmailMsg?.messageId
    ? { "In-Reply-To": prevEmailMsg.messageId, References: prevEmailMsg.messageId }
    : {};

  try {
    await sendWithRetry(() =>
      actualTransporter.sendMail({
        from: actualAccount.senderName
          ? `"${actualAccount.senderName}" <${actualFromEmail}>`
          : actualFromEmail,
        to:      recipient.email,
        subject,
        html,
        headers: threadingHeaders,
      })
    );
  } catch (err) {
    console.error("❌ FOLLOW-UP SEND ERROR:", {
      email:    recipient.email,
      account:  actualAccount.email,
      error:    err.message,
      code:     err.code,
      response: err.response,
    });
    throw err;
  }

  try {
    const exists = await prisma.emailMessage.findFirst({
      where: {
        emailAccountId: actualAccount.id,
        toEmail:        recipient.email,
        subject:        subject,
      },
    });

    if (exists) {
      console.log("⚠️ Follow-up duplicate skipped:", recipient.email);
    } else {
      const newMessageId = `sent-${Date.now()}-${recipient.email}`;

      await prisma.emailMessage.create({
        data: {
          emailAccountId: actualAccount.id,
          messageId:      newMessageId,
          conversationId: `${actualAccount.id}_sent_${recipient.email}`,
          subject:        subject,
          fromEmail:      actualFromEmail,
          fromName:       actualAccount.senderName || null,
          toEmail:        recipient.email,
          body:           html,
          direction:      "sent",
          folder:         "sent",
          sentAt:         new Date(),
          isRead:         true,
        },
      });
    }
  } catch (e) {
    console.error("⚠️ Email log failed (ignored):", e.message);
  }

  const smtpIp = await getSmtpIp(actualAccount.smtpHost);

  await prisma.campaignRecipient.update({
    where: { id: recipient.id },
    data: {
      status:        "sent",
      sentAt:        new Date(),
      sentBodyHtml:  html,
      sentSubject:   prevEmail?.sentSubject ?? fallbackSubject,
      sentFromEmail: actualFromEmail,
      sendingIp:     smtpIp,
    },
  });

  await prisma.dailyEmailLog.upsert({
    where: {
      userId_sentAt: {
        userId: campaign.userId,
        sentAt: getTodayStart(), // 👈 important
      },
    },
    update: {
      count: {
        increment: 1,
      },
    },
    create: {
      userId: campaign.userId,
      userName: campaign.user?.name || "Unknown",
      empId: campaign.user?.empId || "N/A",
      count: 1,
      sentAt: getTodayStart(),
    },
  });
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 7 — PUBLIC ENTRY POINT  sendBulkCampaign
═══════════════════════════════════════════════════════════════════════════ */

export async function sendBulkCampaign(campaignId) {

  // ── 1. Load campaign ─────────────────────────────────────────────────
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      user: true, // 👈 REQUIRED
    },
  });

  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  if (campaign.status !== "sending") {
    console.log(`⏭️ Campaign ${campaignId} already handled (status=${campaign.status})`);
    return;
  }

  const { userId } = campaign;

  // ── 2. Global gate — sending window ──────────────────────────────────
  //    If triggered outside the window (e.g. a scheduled job fires early),
  //    wait here before doing any work.
  // if (!isWithinSendingWindow()) {
  //   console.log(`🌙 Campaign ${campaignId} triggered outside sending window. Waiting for 5 PM…`);
  //   await waitForSendingWindow();

  //   // Re-check status after sleep
  //   const refreshed = await prisma.campaign.findUnique({
  //     where:  { id: campaignId },
  //     select: { status: true },
  //   });
  //   if (!refreshed || refreshed.status !== "sending") {
  //     console.log(`⏹ Campaign ${campaignId} stopped during window-wait at entry. Aborting.`);
  //     return;
  //   }
  // }

  // ── 3. Global gate — daily limit ─────────────────────────────────────
  const sentToday = await getDailyCount(userId);
  if (sentToday >= DAILY_LIMIT) {
    console.log(`🚫 Daily limit reached before start. Waiting...`);

    const waitMs = msUntilNextWindow();
    const waitMin = Math.ceil(waitMs / 60000);

    console.log(`⏳ Sleeping ${waitMin} minutes until reset`);

    await sleep(waitMs);

    console.log(`🔄 Resuming campaign after reset`);
  }

  console.log("📦 Campaign loaded:", {
    id:       campaign.id,
    status:   campaign.status,
    sendType: campaign.sendType,
    dailySentSoFar: sentToday,
  });

  // ── 4. Mark as sending (idempotent) ──────────────────────────────────
  await prisma.campaign.update({
    where: { id: campaignId },
    data:  { status: "sending" },
  });

  // ── 5. Parse config ───────────────────────────────────────────────────
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

  // ── 6. Resolve parent campaign for follow-ups ─────────────────────────
  let originalCampaignId = null;
  if (campaign.sendType === "followup" && campaign.parentCampaignId) {
    originalCampaignId = await resolveOriginalCampaignId(campaign.parentCampaignId);
  }

  // ── 7. Load pending recipients ────────────────────────────────────────
  let pendingRecipients;

  if (campaign.sendType === "followup") {
    if (!originalCampaignId) {
      console.error(`❌ Campaign ${campaignId}: followup has no resolvable originalCampaignId — aborting`);
      await updateCampaignStatus(campaignId);
      return;
    }

    const originalRecipients = await prisma.campaignRecipient.findMany({
      where:  { campaignId: originalCampaignId, status: "sent" },
      select: { email: true },
    });

    const validEmails = originalRecipients.map(r => r.email);

    pendingRecipients = await prisma.campaignRecipient.findMany({
      where: {
        campaignId,
        status: "pending",
        email:  { in: validEmails },
      },
      select:  { id: true, email: true, accountId: true, retryCount: true },
      orderBy: { id: "asc" },
    });
  } else {
    pendingRecipients = await prisma.campaignRecipient.findMany({
      where:   { campaignId, status: "pending" },
      select:  { id: true, email: true, accountId: true, retryCount: true },
      orderBy: { id: "asc" },
    });
  }

  if (!pendingRecipients.length) {
    console.log(`ℹ️ No pending recipients for campaign ${campaignId}`);
    await updateCampaignStatus(campaignId);
    return;
  }

  // ── 8. Build assignment map ───────────────────────────────────────────
  const count       = pendingRecipients.length;
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

  // ── 9. Dispatch per-account processors ───────────────────────────────
  const accountIds = [
    ...new Set(pendingRecipients.map(r => r.accountId).filter(Boolean)),
  ];

  if (!accountIds.length) {
    console.error(`❌ Campaign ${campaignId}: no accountIds on pending recipients`);
    await updateCampaignStatus(campaignId);
    return;
  }

  await Promise.allSettled(
    accountIds.map(accountId =>
      processAccountBatched({
        campaignId,
        accountId,
        campaign,
        assignmentMap,
        originalCampaignId,
        customLimits,
        userId,          // ← passed through for daily counter
      })
    )
  );

  // ── 10. Final status ──────────────────────────────────────────────────
  await updateCampaignStatus(campaignId);
  // First immediate check
 

// 🔥 Add delayed re-check (VERY IMPORTANT)
setTimeout(async () => {
  await updateCampaignStatus(campaignId);
}, 5000); // 5 sec later
  console.log(`✅ Campaign ${campaignId} batch processing complete`);
}


/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 8 — updateCampaignStatus  (unchanged)
═══════════════════════════════════════════════════════════════════════════ */

async function updateCampaignStatus(campaignId) {

  const stats = await prisma.campaignRecipient.groupBy({
    by: ["status"],
    where: { campaignId },
    _count: { status: true },
  });

  // ✅ ADD processing
  const counts = { sent: 0, failed: 0, pending: 0, processing: 0 };

  for (const row of stats) {
    counts[row.status] = row._count.status;
  }

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { userId: true, status: true },
  });

  if (campaign?.status === "stopped") {
    console.log(`⏹ Campaign ${campaignId} was stopped — skipping status update`);
    return;
  }

  let finalStatus;

  // ✅ FIX: include processing
  if (counts.pending > 0 || counts.processing > 0) {
    finalStatus = "sending";
  } 
  else if (counts.sent === 0 && counts.failed > 0) {
    finalStatus = "failed";
  } 
  else {
    finalStatus = "completed";
  }

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: finalStatus },
  });

  // Cache clear (keep as is)
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