import cron from "node-cron";
import prisma from "../prisma.js";
import { sendBulkCampaign } from "../services/campaignMailer.service.js";

export function startCampaignScheduler() {
  console.log("⏰ Campaign scheduler started");

  // Runs every minute
  cron.schedule("* * * * *", async () => {
    try {
      const dueCampaigns = await prisma.campaign.findMany({
        where: {
          status: "scheduled",
          scheduledAt: {
            lte: new Date(),
          },
        },
      });

      for (const campaign of dueCampaigns) {
        console.log("📤 Sending scheduled campaign:", campaign.id);

        // Mark as sending (prevents double send)
        await prisma.campaign.update({
          where: { id: campaign.id },
          data: { status: "sending" },
        });

        // Send emails
        await sendBulkCampaign(campaign.id);
      }
    } catch (err) {
      console.error("❌ Campaign scheduler error:", err);
    }
  });
}
