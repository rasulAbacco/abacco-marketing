// server/worker.js
import prisma from "./src/prisma.js";
import { runSync } from "./src/services/imap.service.js";
import { startCampaignScheduler } from "./src/utils/campaignScheduler.js";
import { sendBulkCampaign } from "./src/services/campaignMailer.service.js";

console.log("🟢 Worker running");

// --------------------------------------------------
// 1️⃣ RESUME INTERRUPTED CAMPAIGNS (VERY IMPORTANT)
// --------------------------------------------------
async function resumeSendingCampaigns() {
  try {
    const runningCampaigns = await prisma.campaign.findMany({
      where: { status: "sending" },
    });

    console.log(`♻️ Resuming ${runningCampaigns.length} running campaigns`);

    for (const campaign of runningCampaigns) {
      sendBulkCampaign(campaign.id).catch(err => {
        console.error(`❌ Resume failed for campaign ${campaign.id}`, err);
      });
    }
  } catch (err) {
    console.error("❌ Resume campaigns error:", err);
  }
}

// --------------------------------------------------
// 2️⃣ START EVERYTHING ON WORKER BOOT
// --------------------------------------------------
(async function bootWorker() {
  // Resume campaigns first
  await resumeSendingCampaigns();

  // Start campaign scheduler (CRON)
  startCampaignScheduler();
})();

// --------------------------------------------------
// 3️⃣ IMAP SYNC (SAFE BACKGROUND TASK)
// --------------------------------------------------
setInterval(() => {
  runSync(prisma).catch(err =>
    console.error("❌ IMAP sync error:", err)
  );
}, 60 * 1000);
