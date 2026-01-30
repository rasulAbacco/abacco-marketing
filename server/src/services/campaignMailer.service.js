import nodemailer from "nodemailer";
import prisma from "../prismaClient.js";
import { decrypt } from "../utils/crypto.js";
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
    <div style="font-size:14px; line-height:1.6; color:#000;">
      
      <!-- Follow-up (top) -->
      <div>
        ${followUpBody}
      </div>

      <br />
      <hr style="border:none;border-top:1px solid #ccc;margin:16px 0;" />

      <!-- Thread header -->
      <div style="font-size:14px; line-height:1.5;">
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
        font-size:14px;
        line-height:1.6;
        color:#000;
      ">
        ${originalBody}
      </blockquote>

    </div>
  `;
}

function buildSignature(account) {
  const name =
    account.senderName ||
    account.email?.split("@")[0] ||
    "Sender";

  return `
    <div style="font-size:15px; line-height:1.6; color:#000; font-family:Calibri, Arial, sans-serif;">
    <b>
      <br/>
      Regards,<br/>
      ${name} - Marketing Analyst</b>
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

function getLimit(provider = "") {
  const key = provider.toLowerCase();
  return SAFE_LIMITS[key] || SAFE_LIMITS.custom;
}

function getDomainLabel(email = "") {
  const domain = email.split("@")[1]?.toLowerCase() || "";

  // common providers
  if (domain.includes("gmail")) return "gmail";
  if (domain.includes("yahoo")) return "yahoo";
  if (domain.includes("outlook") || domain.includes("hotmail")) return "outlook";

  // company domains: bouncecure.com → bouncecure
  return domain.split(".")[0] || "client";
}


/* ------------------ main sender ------------------ */

export async function sendBulkCampaign(campaignId) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { recipients: true },
  });

  if (!campaign) throw new Error("Campaign not found");

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
  if (!recipients.length) return;

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

    // 🔽 ADD THIS DIRECTLY BELOW
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



        let smtpPassword = account.encryptedPass;

        if (typeof smtpPassword === "string" && smtpPassword.includes(":")) {
          smtpPassword = decrypt(smtpPassword);
        }

        const domain = (account.email.split("@")[1] || "localhost").toLowerCase();

        const transporter = nodemailer.createTransport({
          host: account.smtpHost,
          port: Number(account.smtpPort),
          secure: Number(account.smtpPort) === 465,

          // 🔥 THIS FIXES REDIFF HELO ERROR
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
                originalWithSignature = originalBodyHtml + originalSignature;
              }
            }
          }

          const recipientIndex = recipients.findIndex(r => r.id === recipient.id);

          const rawSubject = subjectPlan[recipientIndex];
          const label = getDomainLabel(recipient.email);
          const subject = `${label} - ${rawSubject}`;

          const followUpBody = pitchPlan[recipientIndex] + signature;

          const html = buildFollowupHtml({
            followUpBody,
            originalBody: originalWithSignature,
            from: fromEmail,
            to: recipient.email,
            sentAt: new Date().toLocaleString(),
            subject
          });


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
            data: {
              status: "sent",
              sentAt: new Date(),
              accountId: account.id,
              sentSubject: subject,
              sentBodyHtml: html,
              sentFromEmail: fromEmail
            }
          });

          // ✅ ADD throttling here also
          const limit = getLimit(account.provider);
          const delay = (2 * 60 * 60 * 1000) / limit;
          await sleep(delay);

        } catch (err) {

          // mark recipient failed
          await prisma.campaignRecipient.update({
            where: { id: recipient.id },
            data: { status: "failed", error: err.message }
          });

          // ⛔ IMPORTANT: pause campaign
          await prisma.campaign.update({
            where: { id: campaignId },
            data: { status: "paused" }
          });

          console.log("Campaign paused due to error:", err.message);

          return; // stop sending safely
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



          let smtpPassword = account.encryptedPass;

          if (typeof smtpPassword === "string" && smtpPassword.includes(":")) {
            smtpPassword = decrypt(smtpPassword);
          }

          const domain = (account.email.split("@")[1] || "localhost").toLowerCase();

          const transporter = nodemailer.createTransport({
            host: account.smtpHost,
            port: Number(account.smtpPort),
            secure: Number(account.smtpPort) === 465,

            // 🔥 THIS FIXES REDIFF HELO ERROR
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
        const html = `
          <div style="font-family:Calibri, Arial, sans-serif; font-size:14px; line-height:1.0; color:#000;">
            ${body}
            ${signature}
          </div>
        `;


        await transporter.sendMail({
          from: account.senderName
            ? `"${account.senderName}" <${fromEmail}>`
            : fromEmail,
          to: recipient.email,
          subject,
          html
        });

        // ✅ update progress
        await prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: { status: "sent", sentAt: new Date(), accountId: account.id }
        });

        // throttle per account
        const limit = getLimit(account.provider);
        const delay = (2 * 60 * 60 * 1000) / limit; // 2 hours window
        await sleep(delay);


      } catch (err) {

        await prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: { status: "failed", error: err.message }
        });

        await prisma.campaign.update({
          where: { id: campaignId },
          data: { status: "paused" }
        });

        console.log("Campaign paused due to error:", err.message);

        return;
      }

    }
  }

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

  if (counts.sent === 0 && counts.failed > 0) {
    finalStatus = "failed";
  }
  else if (counts.sent > 0 && counts.failed > 0) {
    finalStatus = "completed_with_errors";
  }
  else if (counts.pending > 0) {
    finalStatus = "sending";
  }

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: finalStatus },
  });

  console.log(`Campaign ${campaignId} finished with status:`, finalStatus);


  console.log("Campaign completed:", campaignId);
}


