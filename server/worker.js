// worker.js
import prisma from "./src/prismaClient.js";
import { runSync } from "./src/services/imap.service.js";
import { startCampaignScheduler } from "./src/utils/campaignScheduler.js";
import { sendBulkCampaign } from "./src/services/campaignMailer.service.js";

console.log("🚀 Worker running...");

// --------------------------------------------------
// 1️⃣ RECOVER STUCK EMAILS
// --------------------------------------------------
async function recoverStuckEmails() {
  try {
    const FIVE_MIN = 5 * 60 * 1000;

    const result = await prisma.campaignRecipient.updateMany({
      where: {
        status: "processing",
        updatedAt: {
          lt: new Date(Date.now() - FIVE_MIN),
        },
      },
      data: {
        status: "pending",
      },
    });

    if (result.count > 0) {
      console.log(`♻️ Recovered ${result.count} stuck emails`);
    }

  } catch (err) {
    console.error("❌ Error recovering stuck emails:", err.message);
  }
}

// --------------------------------------------------
// 2️⃣ RESUME CAMPAIGNS
// --------------------------------------------------
async function resumeSendingCampaigns() {
  try {
    const runningCampaigns = await prisma.campaign.findMany({
      where: { status: "sending" },
    });

    console.log(`🔄 Resuming ${runningCampaigns.length} running campaigns`);

    for (const campaign of runningCampaigns) {
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
// 3️⃣ RETRY LOGIC
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
// 4️⃣ WORKER BOOT (UPDATED)
// --------------------------------------------------
(async function bootWorker() {
  console.log("⏳ Waiting for DB...");

  setTimeout(async () => {
    console.log("⚙️ Running initial recovery...");

    // ✅ ALWAYS recover first
    await recoverStuckEmails();

    // ✅ THEN resume campaigns
    await resumeWithRetry();

  }, 5000); // 🔥 reduced delay (faster recovery)

  // 🔁 Run recovery every minute
  setInterval(async () => {
    await recoverStuckEmails();
  }, 60000);

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