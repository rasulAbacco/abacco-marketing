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

// ✅ This builds the exact structure shown in preview
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
    <div style="color:${baseColor}; font-family: Calibri, sans-serif;">

      <!-- Follow-up message -->
      <div>
        ${followUpBody}
      </div>

      <br />
      <hr style="border:none;border-top:1px solid #ccc;margin:16px 0;" />

      <!-- Thread header -->
      <div style="
        font-size:13px;
        line-height:1.5;
        color:${baseColor};
      ">
        <b>From:</b> ${from}<br/>
        <b>Sent:</b> ${sentAt}<br/>
        <b>To:</b> ${to}<br/>
        <b>Subject:</b> ${subject}
      </div>

      <br />

      <!-- Previous message -->
      <blockquote style="
        margin:0;
        padding-left:5px;
        border-left:2px solid #ccc;
        color:${baseColor};
      ">
        ${originalBody}y
      </blockquote>

    </div>
  `;
}

function buildSignature(account, baseStyles = {}) {
  const name =
    account.senderName ||
    account.email?.split("@")[0] ||
    "Sender";

  const safeStyles = {
    fontFamily: baseStyles.fontFamily || "Calibri, sans-serif",
    fontSize: baseStyles.fontSize || "15px",
    color: baseStyles.color || "#000000",
  };

  return `
    <div style="
      margin-top:16px;
      font-family:${safeStyles.fontFamily};
      font-size:${safeStyles.fontSize};
      line-height:1.6;
      color:${safeStyles.color};
      font-weight:bold;
    ">
      Regards,<br/>
      ${name} - Marketing Analyst
    </div>
  `;
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
  
  // Better color extraction - look for color in style attributes
  let color = '#000000';
  
  // Try to find color in inline styles
  const colorStyleMatch = html.match(/style="[^"]*color:\s*([^;"]+)/i);
  if (colorStyleMatch) {
    color = colorStyleMatch[1].trim();
  } else {
    // Try to find color in span style
    const spanColorMatch = html.match(/<span[^>]*style="[^"]*color:\s*([^;"]+)/i);
    if (spanColorMatch) {
      color = spanColorMatch[1].trim();
    }
  }
  
  // Ensure we have a valid color
  if (!color || color === 'inherit') {
    color = '#000000';
  }
  
  return {
    fontFamily: fontFamilyMatch ? fontFamilyMatch[1].trim() : 'Calibri, sans-serif',
    fontSize: fontSizeMatch ? fontSizeMatch[1].trim() : '15px',
    color: color
  };
}

export async function sendBulkCampaign(campaignId) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { recipients: true },
  });

  if (campaign.status !== "sending") {
    console.log("⏭️ Campaign already handled:", campaignId);
    return;
  }
  
  console.log("📦 Campaign loaded:", {
    id: campaign?.id,
    status: campaign?.status,
    sendType: campaign?.sendType,
    recipients: campaign?.recipients?.length
  });

  if (!campaign) throw new Error("Campaign not found");
  
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
  const recipients = campaign.recipients.filter(r => r.status === "pending");
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

    for (const [accountId, group] of Object.entries(grouped)) {

      const account = await prisma.emailAccount.findUnique({
        where: { id: Number(accountId) }
      });
      if (!account) continue;

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

      // ✅ ADD RATE LIMITING
      let accountSendCount = 0;
      let accountStartTime = Date.now();

      for (let i = 0; i < group.length; i++) {
            // stop cmapign
            const latestCampaign = await prisma.campaign.findUnique({
              where: { id: campaignId },
              select: { status: true }
            });

            if (latestCampaign.status !== "sending") {
              console.log("⏹ Campaign manually stopped:", campaignId);
              return;
            }

        const r = group[i];

        try {
          // ✅ RATE LIMIT CHECK
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

          // Get follow-up body for this recipient
          const followupBodyRaw = pitchPlan[i];
          const followupBody = normalizeHtmlForEmail(followupBodyRaw);

          const baseStyles = extractBaseStyles(followupBody);

          const unsafeColors = ["#fff", "#ffffff", "white", "transparent"];
          if (!baseStyles.color || unsafeColors.includes(baseStyles.color.toLowerCase())) {
            baseStyles.color = "#000000";
          }

          const signature = buildSignature(account, baseStyles);
          const followupWithSignature = followupBody + signature;

          // ✅ Get ACTUAL sent email data from recipient record
          let originalBodyHtml = r.sentBodyHtml || "";
          const originalSubject = r.sentSubject || subjects[0];
          const originalFrom = r.sentFromEmail || account.email;
          
          // Format the sent date
          const originalDate = r.sentAt ? new Date(r.sentAt) : new Date();
          const sentAt = originalDate.toLocaleString("en-US", {
            month: "numeric",
            day: "numeric",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false
          });

          // ✅ Build threaded email with exact preview structure
          const threadedHtml = buildFollowupHtml({
            followUpBody: followupWithSignature,
            originalBody: originalBodyHtml,
            from: originalFrom,
            to: r.email,
            sentAt: sentAt,
            subject: originalSubject
          });

          const html = `<!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="margin:0; padding:0; font-family: Calibri, sans-serif;">
            ${threadedHtml}
          </body>
          </html>
          `;

          // ✅ Subject should be "Re: original subject"
          const label = getDomainLabel(r.email);
          const subject = `Re: ${label} - ${originalSubject}`;

          await transporter.sendMail({
            from: account.senderName
              ? `"${account.senderName}" <${fromEmail}>`
              : fromEmail,
            to: r.email,
            subject: subject,
            html,
          });

          await prisma.campaignRecipient.update({
            where: { id: r.id },
            data: { status: "sent", sentAt: new Date() }
          });

          accountSendCount++;

          console.log(`✅ [FOLLOWUP] ${account.email} → ${r.email} (${accountSendCount}/${limit})`);

          await sleep(delayPerEmail);

        } catch (err) {
          console.error(`❌ Failed followup to ${r.email}:`, err.message);

          await prisma.campaignRecipient.update({
            where: { id: r.id },
            data: { status: "failed", error: err.message }
          });

          // Stop if authentication failed
          if (
            err.message.includes("Invalid login") ||
            err.message.includes("authentication failed")
          ) {
            await prisma.campaign.update({
              where: { id: campaignId },
              data: { 
                status: "failed",
                error: `Authentication failed for ${account.email}` 
              }
            });

            console.log("Campaign stopping due to error:", err.message);
            await updateCampaignStatus(campaignId); 
            return; 
          }
        }
      }
    }
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

            const signature = buildSignature(account, baseStyles);

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

  if (counts.pending > 0) {
    finalStatus = "sending";
  }
  else if (counts.sent === 0 && counts.failed > 0) {
    finalStatus = "failed";
  }
  else if (counts.sent > 0 && counts.failed > 0) {
    finalStatus = "completed_with_errors";
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