// server/server.js
import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";

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

const app = express();
const prisma = new PrismaClient();

// --------------------
// Middlewares
// --------------------
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.use(
  cors({
    origin: [
      "http://localhost:5173",
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
    const campaigns = await prisma.campaign.findMany({
      where: { status: "sending" }
    });

    if (!campaigns.length) {
      console.log("✅ No interrupted campaigns to resume");
      return;
    }

    console.log(`🔄 Found ${campaigns.length} campaign(s) to resume`);

    for (const campaign of campaigns) {
      console.log("🔄 Resuming campaign:", campaign.id);

      // Fire-and-forget resume
      sendBulkCampaign(campaign.id).catch((err) => {
        console.error(`❌ Resume error for campaign ${campaign.id}:`, err);
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

  // Start scheduled campaign checker
  startCampaignScheduler();

  // 🔥 IMPORTANT: Resume campaigns that were interrupted
  await resumeSendingCampaigns();
});
