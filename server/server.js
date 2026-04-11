// server/server.js
import express from "express";
import cors from "cors";
import prisma from "./src/prismaClient.js";

// Routes
import accountRoutes from "./src/routes/inbox/accounts.js";
import inboxRoutes from "./src/routes/inbox/inbox.js";
import customStatusRoutes from "./src/routes/inbox/customStatusRoutes.js";
import userRoutes from "./src/routes/user.js";
import smtpMailerRoutes from "./src/routes/inbox/smtpMailerRoutes.js";
import campaignsRoutes from "./src/routes/campaigns.routes.js";
import pitchRoutes from "./src/routes/pitch.routes.js";
import leadsRoutes from "./src/routes/leads.routes.js";
import { startCampaignScheduler } from "./src/utils/campaignScheduler.js";
import analyticsRoutes from "./src/routes/analytics.routes.js";
import { sendBulkCampaign } from "./src/services/campaignMailer.service.js";
import { startFollowupCleanupJob } from "./src/controllers/campaigns.controller.js";
import accountGroupsRoutes from "./src/routes/inbox/accountGroups.js"; // ✅ NEW

const app = express();


// --------------------
// Middlewares
// --------------------
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "https://abaccomarketing.onrender.com",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true,
  })
);

// --------------------
// Routes
// --------------------
app.use("/api/accounts", accountRoutes);
app.use("/api/inbox", inboxRoutes);
app.use("/api/customStatus", customStatusRoutes);
app.use("/api/smtp", smtpMailerRoutes);
app.use("/api/users", userRoutes);
app.use("/api/pitches", pitchRoutes);
app.use("/api/leads", leadsRoutes);
app.use("/api/campaigns", campaignsRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/account-groups", accountGroupsRoutes); // ✅ NEW

// --------------------
// Health check
// --------------------
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// --------------------
// Resume interrupted campaigns
// --------------------
async function resumeSendingCampaigns() {
  try {
    console.log("🔄 Checking for interrupted campaigns...");

    // Find campaigns that were mid-send
    const campaigns = await prisma.campaign.findMany({
      where: { status: "sending" },
      select: { id: true }
    });

    if (!campaigns.length) {
      console.log("✅ No interrupted campaigns found");
      return;
    }

    console.log(`🔎 Found ${campaigns.length} campaign(s) in 'sending' state`);

    for (const campaign of campaigns) {

      // Count pending emails only
      const pendingCount = await prisma.campaignRecipient.count({
        where: {
          campaignId: campaign.id,
          status: {
            in: ["pending", "processing"] // ✅ FIX
          }
        }
      });

      if (pendingCount === 0) {
        console.log(`⚠️ Campaign ${campaign.id} has no pending emails. Fixing status...`);

        // Double check final status
        const sentCount = await prisma.campaignRecipient.count({
          where: { campaignId: campaign.id, status: "sent" }
        });

        const failedCount = await prisma.campaignRecipient.count({
          where: { campaignId: campaign.id, status: "failed" }
        });

        let finalStatus = "completed";

        if (sentCount === 0 && failedCount > 0) {
          finalStatus = "failed";
        }

        await prisma.campaign.update({
          where: { id: campaign.id },
          data: { status: finalStatus }
        });

        console.log(`✅ Campaign ${campaign.id} updated to ${finalStatus}`);
        continue;
      }

      console.log(
        `🚀 Resuming campaign ${campaign.id} with ${pendingCount} pending emails`
      );

      // Resume only remaining pending emails
      sendBulkCampaign(campaign.id).catch((err) => {
        console.error(
          `❌ Resume error for campaign ${campaign.id}:`,
          err.message
        );
      });
    }

  } catch (error) {
    console.error("❌ Error while resuming campaigns:", error);
  }
}

// --------------------
// Start server
// --------------------
const PORT = process.env.PORT || 5000;

app.listen(PORT, async () => {
  console.log(`✅ API server running on port ${PORT}`);

  startCampaignScheduler(); // optional (can move to worker)
});

startFollowupCleanupJob();
resumeSendingCampaigns();