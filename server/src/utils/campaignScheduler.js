// server/src/utils/campaignScheduler.js
import cron from "node-cron";
import prisma from "../prisma.js";
import { sendBulkCampaign } from "../services/campaignMailer.service.js";

export function startCampaignScheduler() {
  console.log("⏰ Campaign scheduler started");

  // Run every minute
  cron.schedule("* * * * *", async () => {
    try {
      const dueCampaigns = await prisma.campaign.findMany({
        where: {
          status: "scheduled",
          scheduledAt: { lte: new Date() }
        }
      });

      if (!dueCampaigns.length) return;

      console.log(`📋 Found ${dueCampaigns.length} due campaigns`);

      for (const campaign of dueCampaigns) {
        // 🔒 ATOMIC LOCK (VERY IMPORTANT)
        const updated = await prisma.campaign.updateMany({
          where: {
            id: campaign.id,
            status: "scheduled"
          },
          data: { status: "sending" }
        });

        // already picked by worker
        if (updated.count === 0) continue;

        console.log("📤 Triggering campaign:", campaign.id);

        sendBulkCampaign(campaign.id).catch(err => {
          console.error(`❌ Campaign ${campaign.id} failed:`, err);
        });
      }
    } catch (err) {
      console.error("❌ Scheduler error:", err);
    }
  });
}
