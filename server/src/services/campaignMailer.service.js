// FIXED: campaignMailer.service.js - Complete follow-up fix
// This ensures follow-ups send with the exact structure shown in preview

import nodemailer from "nodemailer";
import prisma from "../prismaClient.js";
import { decrypt } from "../utils/crypto.js";
import cache from "../utils/cache.js";

/* ------------------ helpers ------------------ */

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

// ✅ NO outer color override - pitch content carries its own colors from CreatePitch
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

      <!-- Previous message: use div not blockquote — Gmail collapses blockquotes -->
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
 * Extracts only the inner <body> content from a stored full HTML email.
 * sentBodyHtml contains a full <!DOCTYPE html> wrapper — embedding it inside
 * a <blockquote> breaks email clients. We must strip it first.
 */
/**
 * Extracts the original pitch content from a stored sentBodyHtml.
 * The stored HTML is a full email document with <table> wrapper and <style> tags.
 * We extract only the pitch body (no signature, no wrapper table, no style tags)
 * so it can be safely embedded as the "previous message" in a follow-up thread.
 *
 * Structure of stored HTML (from normal campaign send):
 *   <html><head><style>...</style></head>
 *   <body>
 *     <table>
 *       <tr><td>
 *         <div style="font-family:...; color:...;">   ← PITCH WRAPPER DIV
 *           <div>Greetings,</div>                      ← PITCH CONTENT (keep)
 *           ...more pitch divs...
 *           <div style="margin-top:16px">Regards,...</div>  ← SIGNATURE (strip)
 *         </div>
 *       </td></tr>
 *     </table>
 *   </body></html>
 */
function extractBodyContent(fullHtml) {
  if (!fullHtml) return '';

  // Step 1: Strip <style> and <script> from the full document first
  // (they may appear in <head> outside <body> but can still pollute)
  let html = fullHtml
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  // Step 2: Extract <body> content
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyContent = bodyMatch ? bodyMatch[1] : html;

  // Step 3: Find the pitch wrapper div (has font-family in its style attribute)
  // Use depth counting — NOT non-greedy regex — because pitch has many nested divs
  const wrapperRegex = /<div[^>]+style\s*=\s*["'][^"']*font-family[^"']*["'][^>]*>/i;
  const wrapperMatch = bodyContent.match(wrapperRegex);

  if (wrapperMatch) {
    const openTag = wrapperMatch[0];
    const startIdx = bodyContent.indexOf(openTag);
    const innerStart = startIdx + openTag.length;

    // Walk forward counting div nesting depth to find the matching closing </div>
    let depth = 1;
    let pos = innerStart;
    while (pos < bodyContent.length && depth > 0) {
      const nextOpen  = bodyContent.indexOf('<div', pos);
      const nextClose = bodyContent.indexOf('</div>', pos);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        pos = nextOpen + 4;
      } else {
        depth--;
        if (depth === 0) {
          let pitchContent = bodyContent.substring(innerStart, nextClose).trim();
          // Strip the signature block (last child: <div style="margin-top:16px...">)
          pitchContent = pitchContent
            .replace(/<div[^>]*margin-top\s*:\s*16px[^>]*>[\s\S]*?<\/div>\s*$/i, '')
            .trim();
          return pitchContent || bodyContent.substring(innerStart, nextClose).trim();
        }
        pos = nextClose + 6;
      }
    }
  }

  // Fallback: return cleaned body content as-is
  return bodyContent.trim();
}

/**
 * Chunks an array into smaller arrays of given size.
 * Used to safely batch DB queries for 800+ emails
 * (large IN clauses can time out or hit DB limits).
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

  // Don't remove color styles - preserve them
  cleaned = cleaned.replace(/font-size:\s*(\d+)pt/gi, (match, size) => {
    const pxSize = Math.round(parseFloat(size) * 1.333);
    return `font-size:${pxSize}px`;
  });

  // Convert font tags to spans but preserve color
  cleaned = cleaned.replace(/<font([^>]*)>/gi, (match, attributes) => {
    // Extract color attribute if present
    const colorMatch = attributes.match(/color="([^"]*)"/i);
    const color = colorMatch ? `color:${colorMatch[1]};` : '';
    
    // Extract other attributes
    const otherAttrs = attributes.replace(/color="([^"]*)"/gi, '');
    
    return `<span style="${color}${otherAttrs}">`;
  });
  cleaned = cleaned.replace(/<\/font>/gi, '</span>');
 
  cleaned = cleaned.replace(/<div>\s*<\/div>/gi, '');
  cleaned = cleaned.replace(/<div><br><\/div>/gi, '<br>');
  cleaned = cleaned.replace(/(<br\s*\/?>\s*){2,}/gi, '<br>');

  cleaned = cleaned.replace(/<p([^>]*)>/gi, 
    '<p$1 style="margin:0; padding:0; mso-margin-top-alt:0; mso-margin-bottom-alt:0; line-height:1.4;">'
  );

  return cleaned;
}

function extractBaseStyles(html) {
  const fontFamilyMatch = html.match(/font-family:\s*([^;}"']+)/i);
  const fontSizeMatch = html.match(/font-size:\s*([^;}"']+)/i);

  const UNSAFE = new Set(['#fff', '#ffffff', 'white', 'transparent', 'inherit', '']);
  let color = '#000000';

  // ✅ Priority 1: Wrapper <div style="...color:#XXXXX"> written by CreatePitch.jsx on save
  // This is the most reliable source - it's the intentional color the user chose
  const wrapperDivMatch = html.match(/^\s*<div[^>]*style="([^"]*)"/i);
  if (wrapperDivMatch) {
    const styleStr = wrapperDivMatch[1];
    const colorInDiv = styleStr.match(/\bcolor:\s*(#[0-9a-fA-F]{3,6})/i);
    if (colorInDiv) {
      const c = colorInDiv[1].trim();
      if (!UNSAFE.has(c.toLowerCase())) {
        color = c;
      }
    }
  }

  // ✅ Priority 2: <font color="#..."> — browser writes this for execCommand('foreColor')
  // Only use this if wrapper div had no color (old pitches saved before fix)
  if (color === '#000000') {
    const fontTagColor = html.match(/<font[^>]*\bcolor="(#[0-9a-fA-F]{3,6})"/i);
    if (fontTagColor) {
      const c = fontTagColor[1].trim();
      if (!UNSAFE.has(c.toLowerCase())) {
        color = c;
      }
    }
  }

  // ✅ Priority 3: <span style="color:#..."> — fallback for styled spans
  if (color === '#000000') {
    const spanColor = html.match(/<span[^>]*style="[^"]*\bcolor:\s*(#[0-9a-fA-F]{3,6})/i);
    if (spanColor) {
      const c = spanColor[1].trim();
      if (!UNSAFE.has(c.toLowerCase())) {
        color = c;
      }
    }
  }

  return {
    fontFamily: fontFamilyMatch ? fontFamilyMatch[1].trim() : 'Calibri, sans-serif',
    fontSize: fontSizeMatch ? fontSizeMatch[1].trim() : '15px',
    color: color
  };
}

export async function sendBulkCampaign(campaignId) {
  // ✅ FIX 1: Load campaign WITHOUT recipients to avoid loading 5000+ sentBodyHtml
  // rows (~50KB each) into RAM at once — that's 250MB+ and causes crashes/timeouts.
  // We fetch recipients separately in a lean query below.
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
  });

  if (!campaign) throw new Error("Campaign not found");

  if (campaign.status !== "sending") {
    console.log("⏭️ Campaign already handled:", campaignId);
    return;
  }
  
  console.log("📦 Campaign loaded:", {
    id: campaign?.id,
    status: campaign?.status,
    sendType: campaign?.sendType,
  });
  
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: "sending" }
  });

  let customLimits = {};
  if (campaign.customLimits) {
    try {
      customLimits = JSON.parse(campaign.customLimits);
    } catch (err) {
      console.error("Failed to parse custom limits:", err);
    }
  }

  // ---------------- subjects ----------------
  let subjects;
  try {
    subjects = JSON.parse(campaign.subject || "[]");
  } catch {
    subjects = [campaign.subject];
  }
  if (!subjects.length) throw new Error("Subjects missing");

  // ---------------- pitches ----------------
  let pitchIds;
  try {
    pitchIds = JSON.parse(campaign.pitchIds || "[]");
  } catch {
    pitchIds = [];
  }

  let pitchBodies = [];

  if (pitchIds.length) {
    const pitches = await prisma.pitchTemplate.findMany({
      where: { id: { in: pitchIds } }
    });

    pitchBodies = pitches.map(p => p.bodyHtml).filter(Boolean);
  }

  // ---------------- recipients ----------------
  // ✅ FIX 2: Fetch pending recipients lean (no sentBodyHtml) to avoid RAM crash on 5000+ emails
  const recipients = await prisma.campaignRecipient.findMany({
    where: { campaignId, status: "pending" },
    select: { id: true, email: true, accountId: true, status: true }
  });
  if (!recipients.length) {
    console.log("No pending recipients, marking campaign as completed");
    await updateCampaignStatus(campaignId);
    return;
  }

  // ============================================================
  // ================= FOLLOW-UP FLOW ============================
  // ============================================================
  if (campaign.sendType === "followup") {

    const subjectPlan = distribute(subjects, recipients.length);

    const pitchPlan = pitchBodies.length
      ? distribute(pitchBodies, recipients.length)
      : distribute([campaign.bodyHtml], recipients.length);

    const grouped = {};
    for (const r of recipients) {
      if (!r.accountId) continue;
      if (!grouped[r.accountId]) grouped[r.accountId] = [];
      grouped[r.accountId].push(r);
    }

    const recipientEmails = recipients.map(r => r.email);

    // 🔥 FIX 1: Increase chunk size (important for 5000+ emails)
    const EMAIL_CHUNK = 500;

    const parentRecipientsMap = new Map();

    // ============================================================
    // LOAD ORIGINAL CAMPAIGN DATA
    // ============================================================
    if (campaign.parentCampaignId) {

      let originalCampaignId = campaign.parentCampaignId;
      let walkedLevels = 0;
      const MAX_LEVELS = 10;

      while (walkedLevels < MAX_LEVELS) {

        const ancestor = await prisma.campaign.findUnique({
          where: { id: originalCampaignId },
          select: { id: true, sendType: true, parentCampaignId: true }
        });

        if (!ancestor) break;

        if (ancestor.sendType !== "followup" || !ancestor.parentCampaignId) {
          break;
        }

        originalCampaignId = ancestor.parentCampaignId;
        walkedLevels++;
      }

      console.log(`🔍 Using originalCampaignId=${originalCampaignId}`);

      const emailChunks = chunkArray(recipientEmails, EMAIL_CHUNK);

      for (const chunk of emailChunks) {

        const rows = await prisma.campaignRecipient.findMany({
          where: {
            campaignId: originalCampaignId,
            email: { in: chunk },
            status: "sent"
          },
          select: {
            email: true,
            sentBodyHtml: true,
            sentSubject: true,
            sentFromEmail: true,
            sentAt: true
          }
        });

        for (const row of rows) {
          parentRecipientsMap.set(row.email, row);
        }

        await sleep(30);
      }

      console.log(
        `📬 Loaded ${parentRecipientsMap.size}/${recipientEmails.length} original emails`
      );
    }

    // ============================================================
    // SEND FOLLOWUPS
    // ============================================================

    const recipientIndexMap = new Map(
      recipients.map((r, idx) => [r.email + ":" + r.id, idx])
    );

    await Promise.all(

      Object.entries(grouped).map(async ([accountId, group]) => {

        const account = await prisma.emailAccount.findUnique({
          where: { id: Number(accountId) }
        });

        if (!account) return;

        const limit = getLimit(account.provider, account.id, customLimits);

        const delayPerEmail = (60 * 60 * 1000) / limit;

        let smtpPassword = account.encryptedPass;

        if (smtpPassword.includes(":")) {
          smtpPassword = decrypt(smtpPassword);
        }

        const transporter = nodemailer.createTransport({
          host: account.smtpHost,
          port: Number(account.smtpPort),
          secure: Number(account.smtpPort) === 465,
          auth: {
            user: account.smtpUser || account.email,
            pass: smtpPassword
          },
          tls: { rejectUnauthorized: false }
        });

        const fromEmail = account.smtpUser || account.email;

        let accountSendCount = 0;
        let accountStartTime = Date.now();

        for (let i = 0; i < group.length; i++) {

          const r = group[i];

          const latestCampaign = await prisma.campaign.findUnique({
            where: { id: campaignId },
            select: { status: true }
          });

          if (latestCampaign.status !== "sending") {
            console.log("⏹ Campaign stopped");
            return;
          }

          try {

            // ====================================================
            // RATE LIMIT CONTROL
            // ====================================================

            if (accountSendCount >= limit) {

              const elapsed = Date.now() - accountStartTime;

              if (elapsed < 3600000) {

                const wait = 3600000 - elapsed;

                console.log(`⏳ ${account.email} waiting ${Math.ceil(wait / 60000)}m`);

                await sleep(wait);
              }

              accountSendCount = 0;
              accountStartTime = Date.now();
            }

            // ====================================================
            // FOLLOWUP BODY
            // ====================================================

            const globalIdx =
              recipientIndexMap.get(r.email + ":" + r.id) ?? i;

            const followupBody = normalizeHtmlForEmail(pitchPlan[globalIdx]);

            const baseStyles = extractBaseStyles(followupBody);

            const signature = buildSignature(account, campaign.senderRole, baseStyles);

            const followupWithSignature = followupBody + signature;

            const originalRecipient = parentRecipientsMap.get(r.email);

            const hasOriginal = !!originalRecipient;

            let subject;
            let html;

            if (hasOriginal) {

              const originalBody = originalRecipient.sentBodyHtml
                ? extractBodyContent(originalRecipient.sentBodyHtml)
                : "";

              const originalSubject = originalRecipient.sentSubject || "";

              const originalFrom =
                originalRecipient.sentFromEmail || fromEmail;

              const sentAt = new Date(
                originalRecipient.sentAt || Date.now()
              ).toLocaleString();

              const threadedHtml = buildFollowupHtml({
                followUpBody: followupWithSignature,
                originalBody,
                from: originalFrom,
                to: r.email,
                sentAt,
                subject: originalSubject,
                baseColor: baseStyles.color || "#000"
              });

              html = `
              <html>
              <body style="font-family:Calibri,sans-serif">
              ${threadedHtml}
              </body>
              </html>
              `;

              subject = `Re: ${originalSubject}`;

            } else {

              const fallbackSubject = subjectPlan[globalIdx];

              html = `
              <html>
              <body style="font-family:Calibri,sans-serif">
              ${followupWithSignature}
              </body>
              </html>
              `;

              subject = `Re: ${fallbackSubject}`;

              console.log(`⚠ No original email found for ${r.email}`);
            }

            // ====================================================
            // SEND EMAIL
            // ====================================================

            await transporter.sendMail({
              from: account.senderName
                ? `"${account.senderName}" <${fromEmail}>`
                : fromEmail,
              to: r.email,
              subject,
              html
            });

            await prisma.campaignRecipient.update({
              where: { id: r.id },
              data: {
                status: "sent",
                sentAt: new Date(),
                sentBodyHtml: html,
                sentSubject: hasOriginal
                  ? originalRecipient.sentSubject
                  : subjectPlan[globalIdx],
                sentFromEmail: fromEmail
              }
            });

            accountSendCount++;

            await sleep(delayPerEmail);

          } catch (err) {

            console.error(`❌ Failed followup to ${r.email}`, err.message);

            await prisma.campaignRecipient.update({
              where: { id: r.id },
              data: {
                status: "failed",
                error: err.message
              }
            });

          }

        }

      })
    );
  }

  // ============================================================
  // ================= NORMAL CAMPAIGN FLOW ======================
  // ============================================================
  else {

    let fromAccountIds;
    try {
      fromAccountIds = JSON.parse(campaign.fromAccountIds || "[]");
    } catch {
      fromAccountIds = [];
    }

    if (!fromAccountIds.length) throw new Error("From accounts missing");

    const subjectPlan = distribute(subjects, recipients.length);
    const fromPlan = distribute(fromAccountIds, recipients.length);

    const pitchPlan = pitchBodies.length
      ? distribute(pitchBodies, recipients.length)
      : null;

    const grouped = {};

    for (let i = 0; i < recipients.length; i++) {
      const accountId = fromPlan[i];

      if (!grouped[accountId]) grouped[accountId] = [];

      grouped[accountId].push({
        recipient: recipients[i],
        rawSubject: subjectPlan[i],
        body: pitchPlan ? pitchPlan[i] : campaign.bodyHtml
      });
    }

    await Promise.all(
      Object.entries(grouped).map(async ([accountId, list]) => {

        const account = await prisma.emailAccount.findUnique({
          where: { id: Number(accountId) }
        });

        if (!account) return;

        const limit = getLimit(account.provider, account.id, customLimits);
        const delayPerEmail = (60 * 60 * 1000) / limit;

        let smtpPassword = account.encryptedPass;
        if (typeof smtpPassword === "string" && smtpPassword.includes(":")) {
          smtpPassword = decrypt(smtpPassword);
        }

        const domain = (account.email.split("@")[1] || "localhost").toLowerCase();

        const transporter = nodemailer.createTransport({
          host: account.smtpHost,
          port: Number(account.smtpPort),
          secure: Number(account.smtpPort) === 465,
          name: domain,
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

        const fromEmail = account.smtpUser || account.email;

        let accountSendCount = 0;
        let accountStartTime = Date.now();

        for (let i = 0; i < list.length; i++) {
           // stop Campaign
          const latestCampaign = await prisma.campaign.findUnique({
            where: { id: campaignId },
            select: { status: true }
          });

          if (latestCampaign.status !== "sending") {
            console.log("⏹ Campaign manually stopped:", campaignId);
            return;
          }

          const { recipient, rawSubject, body: rawBody } = list[i];

          const label = getDomainLabel(recipient.email);
          const subject = `${label} - ${rawSubject}`;

          try {

            if (accountSendCount >= limit) {
              const timeSinceStart = Date.now() - accountStartTime;

              if (timeSinceStart < 60 * 60 * 1000) {
                const waitTime = (60 * 60 * 1000) - timeSinceStart;
                console.log(`⏳ ${account.email} limit reached. Waiting ${Math.ceil(waitTime / 60000)} minutes...`);
                await sleep(waitTime);
              }

              accountSendCount = 0;
              accountStartTime = Date.now();
            }

            let body = normalizeHtmlForEmail(rawBody);
            const baseStyles = extractBaseStyles(body);

            const unsafeColors = ["#fff", "#ffffff", "white", "transparent"];
            if (
              !baseStyles.color ||
              unsafeColors.includes(baseStyles.color.toLowerCase())
            ) {
              baseStyles.color = "#000000";
            }

            const signature = buildSignature(account, campaign.senderRole, baseStyles);

            // Don't force black color - preserve the user's color choice
            if (!body.includes("color:") && baseStyles.color !== "#000000") {
              body = `<span style="color:${baseStyles.color};">${body}</span>`;
            }

            const html = `<!DOCTYPE html>
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

            await transporter.sendMail({
              from: account.senderName
                ? `"${account.senderName}" <${fromEmail}>`
                : fromEmail,
              to: recipient.email,
              subject,
              html
            });

            // ✅ CRITICAL FIX: Store the actual sent content for follow-ups
            await prisma.campaignRecipient.update({
              where: { id: recipient.id },
              data: { 
                status: "sent", 
                sentAt: new Date(), 
                accountId: account.id,
                sentBodyHtml: html,           // ✅ Store full HTML
                sentSubject: rawSubject,      // ✅ Store subject (without label)
                sentFromEmail: fromEmail      // ✅ Store from email
              }
            });

            accountSendCount++;

            console.log(`✅ ${account.email} → ${recipient.email} (${accountSendCount}/${limit})`);

            await sleep(delayPerEmail);

          } catch (err) {

            console.error(`❌ Failed to send to ${recipient.email}:`, err.message);

            await prisma.campaignRecipient.update({
              where: { id: recipient.id },
              data: { status: "failed", error: err.message }
            });
          }
        }
      })
    );
  }

  await updateCampaignStatus(campaignId);
  console.log(`✅ Campaign ${campaignId} completed all pending emails`);
}

async function updateCampaignStatus(campaignId) {
  const stats = await prisma.campaignRecipient.groupBy({
    by: ["status"],
    where: { campaignId },
    _count: { status: true }
  });

  const counts = {
    sent: 0,
    failed: 0,
    pending: 0
  };

  for (const row of stats) {
    counts[row.status] = row._count.status;
  }

  let finalStatus = "completed";

  // If still sending
  if (counts.pending > 0) {
    finalStatus = "sending";
  }

  // If ALL emails failed
  else if (counts.sent === 0 && counts.failed > 0) {
    finalStatus = "failed";
  }

  // If at least 1 email sent successfully
  else {
    finalStatus = "completed";
  }

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { userId: true }
  });

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: finalStatus },
  });

  if (campaign?.userId) {
    const ranges = ['today', 'week', 'month'];
    ranges.forEach(range => {
      cache.del(`dashboard:${campaign.userId}:${range}`);
    });

    const keys = cache.keys();
    keys.forEach(key => {
      if (key.startsWith(`dashboard:${campaign.userId}:`)) {
        cache.del(key);
      }
    });

    console.log(`🔥 Cache invalidated for user ${campaign.userId}`);
  }

  console.log(`Campaign ${campaignId} status updated to:`, finalStatus);
}