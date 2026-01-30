import prisma from "./src/prisma.js";
import { runSync } from "./src/services/imap.service.js";
import { startCampaignScheduler } from "./src/utils/campaignScheduler.js";

console.log("🟢 Worker running");

setInterval(() => {
  runSync(prisma).catch(console.error);
}, 60 * 1000);

startCampaignScheduler();
