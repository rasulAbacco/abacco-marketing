import prisma from "./src/prismaClient.js";
import { runSync } from "./src/services/imap.service.js";
import { startCampaignScheduler } from "./src/utils/campaignScheduler.js";
import { sendBulkCampaign } from "./src/services/campaignMailer.service.js";

console.log("Worker running...");


async function resumeSendingCampaigns() {
  try {
    const runningCampaigns = await prisma.campaign.findMany({
      where: { status: "sending" },
    });

    console.log(`Resuming ${runningCampaigns.length} running campaigns`);

    for (const campaign of runningCampaigns) {
      sendBulkCampaign(campaign.id).catch((err) => {
        console.error(
          `Resume failed for campaign ${campaign.id}:`,
          err.message
        );
      });
    }
  } catch (err) {
    console.error("Resume campaigns error:", err.message);
    throw err;
  }
}

// --------------------------------------------------
// 2️⃣ RETRY LOGIC
// --------------------------------------------------
async function resumeWithRetry(retries = 5) {
  for (let i = 1; i <= retries; i++) {
    try {
      console.log(`Resume attempt ${i}`);
      await resumeSendingCampaigns();
      console.log("Resume success");
      return;
    } catch (err) {
      console.error(`Attempt ${i} failed`);

      if (i === retries) {
        console.error("All retries failed");
        return;
      }

      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// --------------------------------------------------
// 3️⃣ WORKER BOOT
// --------------------------------------------------
(async function bootWorker() {
  console.log("Waiting for DB...");

  setTimeout(async () => {
    await resumeWithRetry();
  }, 10000); // 10 sec delay

  startCampaignScheduler();
})();

// --------------------------------------------------
// 4️⃣ IMAP SYNC
// --------------------------------------------------
setInterval(() => {
  runSync(prisma).catch((err) =>
    console.error("IMAP sync error:", err.message)
  );
}, 60000);

