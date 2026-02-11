// COMPLETE FIX: campaignMailer.service.js with proper font size handling

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

function buildFollowupHtml({
  followUpBody,
  originalBody,
  from,
  to,
  sentAt,
  subject
}) {
  return `
    <div>
      
      <!-- Follow-up (top) -->
      <div>
        ${followUpBody}
      </div>

      <br />
      <hr style="border:none;border-top:1px solid #ccc;margin:16px 0;" />

      <!-- Thread header -->
      <div style="font-size:14px; line-height:1.5; font-family: Arial, sans-serif;">
        <b>From:</b> ${from}<br/>
        <b>Sent:</b> ${sentAt}<br/>
        <b>To:</b> ${to}<br/>
        <b>Subject:</b> ${subject}
      </div>

      <br />

      <!-- Previous message -->
      <blockquote style="
        margin:0;
        padding-left:12px;
        border-left:2px solid #ccc;
      ">
        ${originalBody}
      </blockquote>

    </div>
  `;
}

// ✅ Signature inherits from pitch context
function buildSignature(account) {
  const name =
    account.senderName ||
    account.email?.split("@")[0] ||
    "Sender";

  return `
    <div style="
      margin-top:16px;
      font-size: 15px;
      line-height: inherit;
      color: #000;
      font-weight: bold;
    ">
      Regards,<br/>
      ${name} - Marketing Analyst
    </div>
  `;
}



function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// 🔥 Default limits
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

// ✅ NEW: Function to ensure proper font size styling
function wrapPitchContent(bodyHtml) {
  // If the body already has a wrapper div with font-size, return as is
  if (bodyHtml.trim().startsWith('<div') && bodyHtml.includes('font-size')) {
    return bodyHtml;
  }
  
  // Otherwise, wrap it in a div with default styling to ensure font sizes render
  return `<div style="font-size: 14px; line-height: 1.5;">${bodyHtml}</div>`;
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

  // ---------------- original body for followup ----------------
  let originalBodyHtml = "";
  if (campaign.sendType === "followup" && campaign.parentCampaignId) {
    const baseCampaign = await prisma.campaign.findUnique({
      where: { id: campaign.parentCampaignId }
    });
    originalBodyHtml = baseCampaign?.bodyHtml || "";
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

      for (const recipient of group) {
        try {
          const signature = buildSignature(account);

          let originalWithSignature =
            recipient.sentBodyHtml ||
            originalBodyHtml ||
            "";

          if (recipient.accountId) {
            const originalAccount = await prisma.emailAccount.findUnique({
              where: { id: recipient.accountId }
            });

            if (originalAccount) {
              const originalSignature = buildSignature(originalAccount);

              if (
                !originalBodyHtml.toLowerCase().includes("regards") &&
                !originalBodyHtml.toLowerCase().includes(originalAccount.senderName?.toLowerCase() || "")
              ) {
                originalWithSignature += `<br>${originalSignature}`;
              }
            }
          }

          const followUpBody = pitchPlan ? pitchPlan[recipients.indexOf(recipient)] : campaign.bodyHtml;

          const sentDate = recipient.sentAt
            ? new Date(recipient.sentAt).toLocaleString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
                hour12: true,
              })
            : new Date().toLocaleString();

          const threadedHtml = buildFollowupHtml({
            followUpBody,
            originalBody: originalWithSignature,
            from: `${account.senderName || account.email.split("@")[0]} <${account.email}>`,
            to: recipient.email,
            sentAt: sentDate,
            subject: recipient.sentSubject || "Previous email",
          });

          const html = `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="UTF-8" />
              <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            </head>
            <body style="margin:0; padding:0; font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.6; color: inherit;">
              ${threadedHtml}
            </body>
            </html>
          `;

          await transporter.sendMail({
            from: account.senderName
              ? `"${account.senderName}" <${fromEmail}>`
              : fromEmail,
            to: recipient.email,
            subject: recipient.sentSubject || "RE: Previous email",
            html,
          });

          await prisma.campaignRecipient.update({
            where: { id: recipient.id },
            data: { status: "sent", sentAt: new Date() }
          });

          console.log(`✅ Follow-up sent to ${recipient.email}`);

          await sleep(delayPerEmail);

        } catch (err) {
          console.error(`❌ Failed to send to ${recipient.email}:`, err.message);

          await prisma.campaignRecipient.update({
            where: { id: recipient.id },
            data: { status: "failed", error: err.message }
          });

          console.log("Campaign stopping due to error:", err.message);
          
          await updateCampaignStatus(campaignId); 
          return; 
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

    const accountSendCount = {};
    const accountLastSendTime = {};

    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      const rawSubject = subjectPlan[i];
      const label = getDomainLabel(recipient.email);
      const subject = `${label} - ${rawSubject}`;

      const accountId = fromPlan[i];

      try {
        const account = await prisma.emailAccount.findUnique({
          where: { id: accountId }
        });
        if (!account) continue;

        const limit = getLimit(account.provider, account.id, customLimits);
        const delayPerEmail = (60 * 60 * 1000) / limit;

        if (!accountSendCount[accountId]) {
          accountSendCount[accountId] = 0;
          accountLastSendTime[accountId] = Date.now();
        }

        if (accountSendCount[accountId] >= limit) {
          const timeSinceFirstSend = Date.now() - accountLastSendTime[accountId];
          
          if (timeSinceFirstSend < 60 * 60 * 1000) {
            const waitTime = (60 * 60 * 1000) - timeSinceFirstSend;
            console.log(`⏳ Account ${account.email} reached limit. Waiting ${Math.ceil(waitTime / 1000 / 60)} minutes...`);
            await sleep(waitTime);
          }
          
          accountSendCount[accountId] = 0;
          accountLastSendTime[accountId] = Date.now();
        }

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
        const signature = buildSignature(account);

        const body = pitchPlan ? pitchPlan[i] : campaign.bodyHtml;
        
        // ✅ CRITICAL FIX: Simplified HTML structure for maximum email client compatibility
   
        const cleanBody = body
          .replace(/<div><br><\/div>/gi, "")
          .replace(/<p><br><\/p>/gi, "")
          .replace(/<p>\s*<\/p>/gi, "");

        // ✅ Outlook-safe HTML (TABLE BASED)
        const html = `<!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>

        <body style="margin:0; padding:0;">

          <!-- ✅ Outlook requires table structure -->
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
            style="border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt;">

            <tr>
              <td style="padding:15px;">

                <!-- Content Table -->
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                  style="border-collapse:collapse;">

                  <tr>
                    <td style="
                      mso-line-height-rule:exactly;
                      line-height:1.0;
                      padding:0;
                      margin:0;
                    ">

                      ${cleanBody}

                      <br>

                      ${signature}

                    </td>
                  </tr>

                </table>

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

        await prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: { status: "sent", sentAt: new Date(), accountId: account.id }
        });

        accountSendCount[accountId]++;

        console.log(`✅ Sent ${accountSendCount[accountId]}/${limit} to ${recipient.email} (Account: ${account.email})`);

        await sleep(delayPerEmail);

      } catch (err) {
        console.error(`❌ Failed to send to ${recipient.email}:`, err.message);

        await prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: { status: "failed", error: err.message }
        });

        console.log("Campaign stopping due to error:", err.message);
        
        await updateCampaignStatus(campaignId); 
        return; 
      }
    }
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