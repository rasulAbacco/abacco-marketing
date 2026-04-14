// worker.js
import prisma from "./src/prismaClient.js";
import { runSync } from "./src/services/imap.service.js";
import { startCampaignScheduler } from "./src/utils/campaignScheduler.js";
import { sendBulkCampaign } from "./src/services/campaignMailer.service.js";

console.log("🚀 Worker running...");

// --------------------------------------------------
// 1️⃣ RECOVER STUCK EMAILS (IMPROVED)
// --------------------------------------------------
async function recoverStuckEmails() {
  try {
    const TWO_MIN = 2 * 60 * 1000;

    // ✅ Step 1: Reset stuck "processing" → "pending"
    const recovered = await prisma.campaignRecipient.updateMany({
      where: {
        status: "processing",
        updatedAt: {
          lt: new Date(Date.now() - TWO_MIN),
        },
        retryCount: {
          lt: 3, // ✅ max retry limit
        },
      },
      data: {
        status: "pending",
        retryCount: {
          increment: 1,
        },
        error: "Recovered from stuck processing",
        updatedAt: new Date(),
      },
    });

    // ✅ Step 2: Mark permanently failed (retry exceeded)
    const failed = await prisma.campaignRecipient.updateMany({
      where: {
        status: "processing",
        retryCount: {
          gte: 3,
        },
      },
      data: {
        status: "failed",
        error: "Max retries exceeded",
        updatedAt: new Date(),
      },
    });

    if (recovered.count > 0) {
      console.log(`♻️ Recovered ${recovered.count} stuck emails`);
    }

    if (failed.count > 0) {
      console.log(`❌ Marked ${failed.count} emails as failed (max retries)`);
    }

  } catch (err) {
    console.error("❌ Error recovering stuck emails:", err.message);
  }
}

// --------------------------------------------------
// 2️⃣ RESUME CAMPAIGNS (SAFE)
// --------------------------------------------------
async function resumeSendingCampaigns() {
  try {
    const runningCampaigns = await prisma.campaign.findMany({
      where: { status: "sending" },
      select: { id: true },
    });

    console.log(`🔄 Resuming ${runningCampaigns.length} running campaigns`);

    for (const campaign of runningCampaigns) {

      // ✅ Check if still has pending work
      const remaining = await prisma.campaignRecipient.count({
        where: {
          campaignId: campaign.id,
          status: {
            in: ["pending", "processing"],
          },
        },
      });

      if (remaining === 0) {
        console.log(`✅ Campaign ${campaign.id} already finished, skipping`);
        continue;
      }

      sendBulkCampaign(campaign.id).catch((err) => {
        console.error(
          `❌ Resume failed for campaign ${campaign.id}:`,
          err.message
        );
      });
    }

  } catch (err) {
    console.error("❌ Resume campaigns error:", err.message);
    throw err;
  }
}

// --------------------------------------------------
// 3️⃣ RETRY WRAPPER
// --------------------------------------------------
async function resumeWithRetry(retries = 5) {
  for (let i = 1; i <= retries; i++) {
    try {
      console.log(`🔁 Resume attempt ${i}`);
      await resumeSendingCampaigns();
      console.log("✅ Resume success");
      return;
    } catch (err) {
      console.error(`❌ Attempt ${i} failed`);

      if (i === retries) {
        console.error("❌ All retries failed");
        return;
      }

      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// --------------------------------------------------
// 4️⃣ WORKER BOOT
// --------------------------------------------------
(async function bootWorker() {
  console.log("⏳ Waiting for DB...");

  setTimeout(async () => {
    console.log("⚙️ Running initial recovery...");

    // ✅ ALWAYS recover first
    await recoverStuckEmails();

    // ✅ THEN resume campaigns
    await resumeWithRetry();

  }, 5000);

  // 🔁 Run recovery every minute
  setInterval(async () => {
    await recoverStuckEmails();
  }, 60000);

  // 🔁 Also try resume every 2 min (extra safety)
  setInterval(async () => {
    await resumeSendingCampaigns();
  }, 300000 );

  startCampaignScheduler();
})();

// --------------------------------------------------
// 5️⃣ IMAP SYNC
// --------------------------------------------------
setInterval(() => {
  runSync(prisma).catch((err) =>
    console.error("📩 IMAP sync error:", err.message)
  );
}, 60000);