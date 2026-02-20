import prisma from "../prisma.js";
import { sendBulkCampaign } from "../services/campaignMailer.service.js";
import cache from "../utils/cache.js";

/**
 * Helper function to invalidate all dashboard caches
 */
const invalidateDashboardCache = (userId) => {
  // Invalidate all possible dashboard cache keys
  const ranges = ['today', 'week', 'month'];
  ranges.forEach(range => {
    cache.del(`dashboard:${userId}:${range}`);
  });
  
  // Also invalidate date-specific caches (clear all user caches)
  const keys = cache.keys();
  keys.forEach(key => {
    if (key.startsWith(`dashboard:${userId}:`)) {
      cache.del(key);
    }
  });
  
  // Invalidate locked accounts cache
  cache.del(`locked:${userId}`);
};

/**
 * Create Campaign
 */
export const createCampaign = async (req, res) => {
  try {
    const {
      campaignName,
      subjects,
      bodyHtml,
      recipients,
      fromAccountIds,
      pitchIds,
      sendType,
      scheduledAt,
      customLimits,
      senderRole 
    } = req.body;

    // 1️⃣ Basic validation
    if (!campaignName || !campaignName.trim()) {
      return res.status(400).json({
        success: false,
        message: "Campaign name is required",
      });
    }

    if (
      !subjects?.length ||
      !bodyHtml ||
      !recipients?.length ||
      !fromAccountIds?.length
    ) {
      return res.status(400).json({
        success: false,
        message: "Subjects, body, recipients and from accounts are required",
      });
    }

    // 2️⃣ 🔒 LOCK CHECK (prevent using busy accounts)
    const sendingCampaigns = await prisma.campaign.findMany({
      where: { status: "sending" },
      include: {
        recipients: {
          select: { accountId: true }
        }
      }
    });

    const locked = new Set();

    for (const campaign of sendingCampaigns) {
      try {
        JSON.parse(campaign.fromAccountIds || "[]")
          .forEach(id => locked.add(Number(id)));
      } catch {}

      campaign.recipients.forEach(r => {
        if (r.accountId) locked.add(Number(r.accountId));
      });
    }

    if (sendType === "immediate") {
      const conflict = fromAccountIds.find(id => locked.has(Number(id)));

      if (conflict) {
        return res.status(400).json({
          success: false,
          message: "This email account is already sending a campaign. Please wait until it is completed."
        });
      }
    }

    // 3️⃣ PROVIDER LIMIT VALIDATION (SAFE SENDING) - Now supporting custom limits
    const accounts = await prisma.emailAccount.findMany({
      where: { id: { in: fromAccountIds } }
    });

    // 🔥 Calculate fixed estimated completion time

    const SAFE_LIMITS = {
      gmail: 50,
      gsuite: 80,
      rediff: 40,
      amazon: 60,
      custom: 60
    };

    let totalHourlyCapacity = 0;

    for (const acc of accounts) {
      const provider = (acc.provider || "custom").toLowerCase();
      let limit = SAFE_LIMITS[provider] || SAFE_LIMITS.custom;

      if (customLimits && customLimits[acc.id]) {
        limit = customLimits[acc.id];
      }

      totalHourlyCapacity += limit;
    }

    const hoursNeeded = recipients.length / totalHourlyCapacity;
    const estimatedMs = hoursNeeded * 60 * 60 * 1000;

    const estimatedCompletion = new Date(Date.now() + estimatedMs);


   if (recipients.length > totalHourlyCapacity) {
      console.log(`⚠️ Recipients (${recipients.length}) exceed hourly capacity (${totalHourlyCapacity}). Will send in batches.`);
    }

    // 4️⃣ Auto-generate unique campaign name
    let baseName = campaignName.trim();
    let finalName = baseName;

    const existing = await prisma.campaign.findMany({
      where: {
        userId: req.user.id,
        name: { startsWith: baseName },
      },
      select: { name: true },
    });

    const used = existing.map(c => c.name);

    if (used.includes(baseName)) {
      let i = 2;
      while (used.includes(`${baseName} (${i})`)) {
        i++;
      }
      finalName = `${baseName} (${i})`;
    }

    // 2.5️⃣ SCHEDULE CONFLICT CHECK
    if (sendType === "scheduled" && scheduledAt) {
      const scheduledTime = new Date(scheduledAt);

      const windowStart = new Date(scheduledTime.getTime() - (2 * 60 * 60 * 1000));
      const windowEnd   = new Date(scheduledTime.getTime() + (2 * 60 * 60 * 1000));

      const conflicting = await prisma.campaign.findMany({
        where: {
          OR: [
            { status: "scheduled" },
            { status: "sending" }
          ],
          scheduledAt: {
            gte: windowStart,
            lte: windowEnd
          }
        },
        select: {
          fromAccountIds: true
        }
      });

      const busyAccounts = new Set();

      for (const c of conflicting) {
        try {
          JSON.parse(c.fromAccountIds || "[]")
            .forEach(id => busyAccounts.add(Number(id)));
        } catch {}
      }

      const conflict = fromAccountIds.find(id => busyAccounts.has(Number(id)));

      if (conflict) {
        return res.status(400).json({
          success: false,
          message: "This email account already has another campaign scheduled near this time. Choose another time or account give after 2 hours let."
        });
      }
    }

    // 5️⃣ Create campaign
    const fromIds = fromAccountIds.map(Number);

   const campaign = await prisma.campaign.create({
      data: {
        userId: req.user.id,
        name: finalName,
        bodyHtml,
        sendType,
        estimatedCompletion,
        senderRole, // ✅ Save role

        // ✅ scheduledAt ONLY for scheduled campaigns
        scheduledAt:
          sendType === "scheduled"
            ? new Date(scheduledAt)
            : null,

        // ✅ correct status lifecycle
        status:
          sendType === "scheduled"
            ? "scheduled"
            : "draft",

        subject: JSON.stringify(subjects),
        fromAccountIds: JSON.stringify(fromAccountIds),
        pitchIds: JSON.stringify(pitchIds || []),
        customLimits: customLimits ? JSON.stringify(customLimits) : null,

        recipients: {
          create: recipients.map((email, i) => ({
            email,
            status: "pending",
            accountId: fromIds[i % fromIds.length],
          })),
        },
      },
    });

    // ✅ Proper handling for immediate campaigns
    if (campaign.sendType === "immediate") {
      // Mark as sending
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: "sending" }
      });

      // Invalidate cache
      invalidateDashboardCache(req.user.id);

      // Fire-and-forget (ONLY ONCE)
      sendBulkCampaign(campaign.id).catch(err => {
        console.error(`Error in immediate campaign ${campaign.id}:`, err);
      });
    } else {
      invalidateDashboardCache(req.user.id);
    }



    return res.json({
      success: true,
      data: campaign,
    });

  } catch (err) {
    console.error("Create campaign error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

/**
 * Send Immediately
 */
export const sendCampaignNow = async (req, res) => {
  try {
    const campaignId = Number(req.params.id);

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId }
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found"
      });
    }

    if (!campaign || campaign.status === "sent") {
      return;
    }


    // 🔒 LOCK CHECK (same as before)
    const activeCampaigns = await prisma.campaign.findMany({
      where: {
        status: "sending",
        NOT: { id: campaignId }
      }
    });

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "sending" }
    });


    const locked = new Set();

    for (const c of activeCampaigns) {
      try {
        JSON.parse(c.fromAccountIds || "[]")
          .forEach(id => locked.add(Number(id)));
      } catch {}
    }

    const fromIds = JSON.parse(campaign.fromAccountIds || "[]");
    const conflict = fromIds.find(id => locked.has(Number(id)));

    if (conflict) {
      return res.status(400).json({
        success: false,
        message: "Email account is already used in another campaign"
      });
    }

    // 🔥 Update status to sending
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "sending" }
    });

    // 🔥 INVALIDATE CACHE before sending
    invalidateDashboardCache(campaign.userId);

    // 🔥 Start sending asynchronously
    sendBulkCampaign(campaignId).catch(err => {
      console.error(`Error sending campaign ${campaignId}:`, err);
    });

    return res.json({
      success: true,
      message: "Campaign sending started"
    });

  } catch (err) {
    console.error("sendCampaignNow error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to send campaign"
    });
  }
};

/**
 * Schedule Campaign
 */
export const scheduleCampaign = async (req, res) => {
  try {
    const campaignId = Number(req.params.id);
    const { scheduledAt } = req.body;

    if (!scheduledAt) {
      return res.status(400).json({
        success: false,
        message: "Scheduled time is required"
      });
    }

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId }
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found"
      });
    }

    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        scheduledAt: new Date(scheduledAt),
        status: "scheduled"
      }
    });

    // 🔥 INVALIDATE CACHE
    invalidateDashboardCache(campaign.userId);

    return res.json({ success: true });

  } catch (err) {
    console.error("Schedule campaign error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to schedule campaign"
    });
  }
};

/**
 * Create Follow-up Campaign
 */
export const createFollowupCampaign = async (req, res) => {
  try {
    const { baseCampaignId, subjects, bodyHtml, senderRecipientMap } = req.body;

    if (!baseCampaignId || !senderRecipientMap) {
      return res.status(400).json({
        success: false,
        message: "Invalid payload"
      });
    }

    const baseCampaign = await prisma.campaign.findUnique({
      where: { id: baseCampaignId },
      include: { recipients: true }
    });

    if (!baseCampaign) {
      return res.status(404).json({
        success: false,
        message: "Base campaign not found"
      });
    }

    const sendingCampaigns = await prisma.campaign.findMany({
      where: { status: "sending" },
      include: {
        recipients: {
          select: { accountId: true }
        }
      }
    });

    const locked = new Set();

    for (const campaign of sendingCampaigns) {
      try {
        JSON.parse(campaign.fromAccountIds || "[]")
          .forEach(id => locked.add(Number(id)));
      } catch {}

      campaign.recipients.forEach(r => {
        if (r.accountId) locked.add(Number(r.accountId));
      });
    }

    let finalName = `${baseCampaign.name} (Followup)`;

    const existing = await prisma.campaign.findMany({
      where: {
        userId: req.user.id,
        name: { startsWith: finalName }
      },
      select: { name: true }
    });

    const used = existing.map(c => c.name);

    if (used.includes(finalName)) {
      let i = 2;
      while (used.includes(`${finalName} (${i})`)) {
        i++;
      }
      finalName = `${finalName} (${i})`;
    }

    // ✅ Copy senderRole from parent campaign for follow-ups
    const parentSenderRole = baseCampaign.senderRole || "";

    const followupCampaign = await prisma.campaign.create({
      data: {
        userId: req.user.id,
        name: finalName,
        subject: JSON.stringify(subjects || []),
        bodyHtml: bodyHtml || "",
        sendType: "followup",
        status: "draft",
        parentCampaignId: baseCampaignId,
        fromAccountIds: JSON.stringify([]),
        pitchIds: JSON.stringify([]),
        senderRole: parentSenderRole // ✅ Inherit sender role from parent campaign
      }
    });

    const recipientCreates = [];

    for (const [senderId, emailArray] of Object.entries(senderRecipientMap)) {
      const accountId = Number(senderId);

      if (locked.has(accountId)) {
        await prisma.campaign.delete({
          where: { id: followupCampaign.id }
        });

        return res.status(400).json({
          success: false,
          message: "One or more sender accounts are currently busy. Please wait."
        });
      }

      for (const email of emailArray) {
        const original = baseCampaign.recipients.find(r => r.email === email);

        recipientCreates.push({
          campaignId: followupCampaign.id,
          email,
          status: "pending",
          accountId,
          sentBodyHtml: original?.sentBodyHtml || "",
          sentSubject: original?.sentSubject || "",
          sentFromEmail: original?.sentFromEmail || ""
        });
      }
    }

    // After creating recipients (line 510)
    await prisma.campaignRecipient.createMany({
      data: recipientCreates
    });

    // 🔥 ADD THIS: Update status to sending and trigger the send
    // await prisma.campaign.update({
    //   where: { id: followupCampaign.id },
    //   data: { status: "sending" }
    // });

    // 🔥 ADD THIS: Trigger the sending process
    // sendBulkCampaign(followupCampaign.id).catch(err => {
    //   console.error(`Error in followup campaign ${followupCampaign.id}:`, err);
    // });

    // 🔥 INVALIDATE CACHE
    invalidateDashboardCache(req.user.id);

    return res.json({
      success: true,
      data: followupCampaign
    });

  } catch (err) {
    console.error("Followup campaign error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};

/**
 * Get All Campaigns
 */
export const getAllCampaigns = async (req, res) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: "desc" },
      include: { recipients: true }
    });

    return res.json({ success: true, data: campaigns });
  } catch (err) {
    console.error("Get campaigns error:", err);
    res.status(500).json({ success: false });
  }
};

/**
 * Get Dashboard Campaigns with caching
 */
export const getDashboardCampaigns = async (req, res) => {
  try {
    const { range = "all", date } = req.query;

    // 🔥 REDUCED CACHE TIME - 30 seconds instead of 60
    // This ensures more real-time updates
    const cacheKey = date
      ? `dashboard:${req.user.id}:${date}`
      : `dashboard:${req.user.id}:${range}`;

    const cached = cache.get(cacheKey);
    if (cached) {
      console.log("🟢 CACHE HIT: getDashboardCampaigns");
      return res.json({ success: true, data: cached });
    }

    let startDate = null;
    let endDate = null;
    const now = new Date();

    if (range === "today") {
      startDate = new Date(now.setHours(0, 0, 0, 0));
      endDate = new Date();
    }

    if (range === "week") {
      const firstDay = new Date();
      firstDay.setDate(now.getDate() - now.getDay());
      firstDay.setHours(0, 0, 0, 0);
      startDate = firstDay;
      endDate = new Date();
    }

    if (range === "month") {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date();
    }

    if (date) {
      const d = new Date(date);
      startDate = new Date(d.setHours(0, 0, 0, 0));
      endDate = new Date(d.setHours(23, 59, 59, 999));
    }

    const where = {
      userId: req.user.id,
      ...(startDate && {
        createdAt: {
          gte: startDate,
          lte: endDate
        }
      })
    };

    // ✅ PERF FIX: Exclude heavy fields (sentBodyHtml) from dashboard list query.
    // The full body is only needed in the detail/view modal, not the dashboard.
    const campaigns = await prisma.campaign.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        recipients: {
          select: {
            id: true,
            email: true,
            status: true,
            accountId: true,
            sentAt: true,
            // sentBodyHtml intentionally excluded — large field not needed here
          }
        }
      }
    });

    // Campaign counts
    const totalCampaigns = campaigns.filter(
      c => c.sendType !== "followup"
    ).length;

    const followups = campaigns.filter(c => c.sendType === "followup");
    const totalFollowups = followups.length;
    const followupEmails = followups.reduce(
      (sum, c) => sum + (c.recipients?.length || 0),
      0
    );

    // Recipient counts
    let totalRecipients = 0;
    let sentRecipients = 0;
    let pendingRecipients = 0;
    let failedRecipients = 0;

    campaigns.forEach(campaign => {
      if (campaign.sendType === "followup") return;

      campaign.recipients?.forEach(r => {
        totalRecipients++;

        if (r.status === "sent") sentRecipients++;
        else if (r.status === "pending") pendingRecipients++;
        else if (r.status === "failed") failedRecipients++;
      });
    });

    // ✅ PERF FIX: Collect ALL account IDs from all campaigns in one pass,
    // then do a SINGLE batch DB query instead of one query per campaign (N+1 fix)
    const allAccountIds = new Set();
    for (const campaign of campaigns) {
      try {
        const ids = JSON.parse(campaign.fromAccountIds || "[]");
        ids.forEach(id => allAccountIds.add(Number(id)));
      } catch {}
    }

    let accountEmailMap = {};
    if (allAccountIds.size > 0) {
      const allAccounts = await prisma.emailAccount.findMany({
        where: { id: { in: Array.from(allAccountIds) } },
        select: { id: true, email: true }
      });
      allAccounts.forEach(acc => {
        accountEmailMap[acc.id] = acc.email.split("@")[0] + "@";
      });
    }

    // Recent campaigns — now uses the pre-fetched map, zero extra queries
    const recentCampaigns = campaigns.map(campaign => {
      let fromNames = [];
      try {
        const ids = JSON.parse(campaign.fromAccountIds || "[]");
        fromNames = ids.map(id => accountEmailMap[Number(id)]).filter(Boolean);
      } catch {}
      return { ...campaign, fromNames };
    });

    const responseData = {
      stats: {
        totalCampaigns,
        totalRecipients,
        sentRecipients,
        pendingRecipients,
        failedRecipients,
        totalFollowups,
        followupEmails
      },
      recentCampaigns
    };

    // ✅ PERF FIX: Cache for 30 seconds — enough for real-time feel,
    // but avoids hammering DB on every tab open / refresh.
    cache.set(cacheKey, responseData, 30);

    return res.json({ success: true, data: responseData });

  } catch (err) {
    console.error("Dashboard error:", err);
    res.status(500).json({ success: false });
  }
};

/**
 * Get Campaign Progress
 */
export const getCampaignProgress = async (req, res) => {
  try {
    const id = Number(req.params.id);

    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        recipients: true,
      },
    });

    if (!campaign) {
      return res.status(404).json({ success: false });
    }

    // ✅ Parse custom limits if available
    let customLimits = {};
    if (campaign.customLimits) {
      try {
        customLimits = JSON.parse(campaign.customLimits);
      } catch {}
    }

    // ✅ SAFE LIMITS
    const SAFE_LIMITS = {
      gmail: 50,
      gsuite: 80,
      rediff: 40,
      amazon: 60,
      custom: 60,
    };

    function formatDuration(ms) {
      const totalMinutes = Math.ceil(ms / 60000);
      const h = Math.floor(totalMinutes / 60);
      const m = totalMinutes % 60;
      if (h > 0) return `${h}h ${m}m`;
      return `${m}m`;
    }

    // ✅ Step 1: Get all unique accountIds (ONE TIME)
    const accountIds = [
      ...new Set(
        campaign.recipients
          .map((r) => r.accountId)
          .filter(Boolean)
      ),
    ];

    // ✅ Step 2: Fetch all accounts in ONE query (FAST)
    const accounts = await prisma.emailAccount.findMany({
      where: { id: { in: accountIds } },
    });

    // ✅ Step 3: Create Map for quick lookup
    const accountMap = {};
    accounts.forEach((acc) => {
      accountMap[acc.id] = acc;
    });

    // ✅ Step 4: Group progress by account
    const grouped = {};

    for (const r of campaign.recipients) {
      if (!r.accountId) continue;

      const account = accountMap[r.accountId];
      if (!account) continue;

      const key = account.email;

      if (!grouped[key]) {
        grouped[key] = {
          email: account.email,
          domain: account.provider,
          processing: 0,
          completed: 0,
          eta: "0m",
        };
      }

      if (r.status === "pending") grouped[key].processing++;
      if (r.status === "sent") grouped[key].completed++;
    }

    // ✅ Step 5: Calculate ETA
    for (const row of Object.values(grouped)) {
      const provider = (row.domain || "custom").toLowerCase();

      let limit = SAFE_LIMITS[provider] || SAFE_LIMITS.custom;

      const acc = accounts.find((a) => a.email === row.email);

      if (acc && customLimits[acc.id]) {
        limit = customLimits[acc.id];
      }

      const total = row.processing + row.completed;

      const totalHoursNeeded = total / limit;
      const totalMsNeeded = totalHoursNeeded * 60 * 60 * 1000;

      row.eta = formatDuration(totalMsNeeded);

    }

    // ✅ Return Fast Response
    return res.json({
      success: true,
      data: Object.values(grouped),
    });

  } catch (err) {
    console.error("Progress API error:", err);
    return res.status(500).json({ success: false });
  }
};

/**
 * Get Locked Accounts
 */
export const getLockedAccounts = async (req, res) => {
  try {
    // 🔥 REDUCED CACHE TIME - 10 seconds for more real-time lock status
    const cacheKey = `locked:${req.user.id}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log("🟢 CACHE HIT: getLockedAccounts");
      return res.json({ success: true, data: cached });
    }

    const sendingCampaigns = await prisma.campaign.findMany({
      where: { status: "sending" },
      include: {
        recipients: {
          select: { accountId: true }
        }
      }
    });

    const locked = new Set();

    for (const campaign of sendingCampaigns) {
      try {
        JSON.parse(campaign.fromAccountIds || "[]")
          .forEach(id => locked.add(Number(id)));
      } catch {}

      campaign.recipients.forEach(r => {
        if (r.accountId) locked.add(Number(r.accountId));
      });
    }

    cache.set(cacheKey, Array.from(locked), 10); // 10 seconds cache
    return res.json({
      success: true,
      data: Array.from(locked)
    });

  } catch (err) {
    console.error("getLockedAccounts error:", err);
    res.status(500).json({ success: false });
  }
};

/**
 * Delete Campaign
 */
export const deleteCampaign = async (req, res) => {
  try {
    const campaignId = Number(req.params.id);

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId }
    });

    if (!campaign) {
      return res.status(404).json({ success: false, message: "Campaign not found" });
    }

    // Delete all recipients first
    await prisma.campaignRecipient.deleteMany({
      where: { campaignId }
    });

    // Delete the campaign
    await prisma.campaign.delete({
      where: { id: campaignId }
    });

    // 🔥 INVALIDATE CACHE immediately after deletion
    invalidateDashboardCache(campaign.userId);

    return res.json({ success: true });

  } catch (err) {
    console.error("Delete campaign error:", err);
    res.status(500).json({ success: false });
  }
};

export const getCampaignsForFollowup = async (req, res) => {
  try {
    const allCampaigns = await prisma.campaign.findMany({
      where: {
        userId: req.user.id,
        OR: [
          { sendType: "immediate" },
          { sendType: "scheduled" }
        ],
        status: "completed",
        parentCampaignId: null,
      },
      include: {
        recipients: true
      },
      orderBy: { createdAt: "desc" }
    });

    // Get all completed follow-up campaigns with their parent IDs
    const followupCampaigns = await prisma.campaign.findMany({
      where: {
        userId: req.user.id,
        sendType: "followup",
        status: "completed",
        parentCampaignId: { not: null }
      },
      select: {
        parentCampaignId: true
      }
    });

    // Create a set of campaign IDs that already have follow-ups
    const campaignsWithFollowups = new Set(
      followupCampaigns.map(f => f.parentCampaignId)
    );

    // Filter campaigns
    const now = Date.now();
    const hours24 = 24 * 60 * 60 * 1000;

    const availableCampaigns = allCampaigns.filter(c => {
      const completedTime = new Date(c.createdAt).getTime();
      
      return (
        now - completedTime >= hours24 &&
        !campaignsWithFollowups.has(c.id)
      );
    });

    return res.json({
      success: true,
      data: availableCampaigns
    });

  } catch (err) {
    console.error("Get campaigns for followup error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};


/**
 * Get Single Campaign Details (For View Modal)
 */
export const getSingleCampaign = async (req, res) => {
  try {
    const id = Number(req.params.id);

    // ✅ PERF FIX: Select only fields needed for the view modal.
    // sentBodyHtml can be KB/MB per recipient — skip it here.
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        recipients: {
          select: {
            id: true,
            email: true,
            status: true,
            accountId: true,
            sentAt: true,
            sentSubject: true,
            sentFromEmail: true,
            // sentBodyHtml intentionally excluded — large field not needed in view modal
          }
        }
      }
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found"
      });
    }

    const total = campaign.recipients.length;
    const processing = campaign.recipients.filter(r => r.status === "pending").length;
    const completed = campaign.recipients.filter(r => r.status === "sent").length;
    const failed = campaign.recipients.filter(r => r.status === "failed").length;

    return res.json({
      success: true,
      data: {
        campaign,
        stats: {
          total,
          processing,
          completed,
          failed
        }
      }
    });

  } catch (err) {
    console.error("Get single campaign error:", err);
    res.status(500).json({ success: false });
  }
};

export const stopCampaign = async (req, res) => {
  try {
    const campaignId = Number(req.params.id);

    if (!campaignId) {
      return res.status(400).json({
        success: false,
        message: "Invalid campaign id"
      });
    }

    // 🔍 Find campaign and ensure it belongs to user
    const campaign = await prisma.campaign.findFirst({
      where: {
        id: campaignId,
        userId: req.user.id
      }
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found"
      });
    }

    // ❌ Already stopped / completed / draft
    if (campaign.status !== "sending") {
      return res.status(400).json({
        success: false,
        message: `Cannot stop campaign with status: ${campaign.status}`
      });
    }

    // 🛑 Update status to stopped
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "stopped" }
    });

    // 🔥 Clear dashboard cache
    invalidateDashboardCache(req.user.id);

    return res.json({
      success: true,
      message: "Campaign stopped successfully"
    });

  } catch (err) {
    console.error("Stop campaign error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to stop campaign"
    });
  }
};


export const updateFollowupRecipients = async (req, res) => {
  try {
    const { campaignId, recipients } = req.body;

    console.log("Update recipients request:", { campaignId, recipientsCount: recipients?.length });

    // Validation
    if (!campaignId || !Array.isArray(recipients)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payload: campaignId and recipients array required"
      });
    }

    if (recipients.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot save empty recipient list"
      });
    }

    // Verify campaign exists and belongs to user
    const campaign = await prisma.campaign.findFirst({
      where: {
        id: Number(campaignId),
        userId: req.user.id
      }
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found or access denied"
      });
    }

    // Delete existing recipients
    await prisma.campaignRecipient.deleteMany({
      where: { campaignId: Number(campaignId) }
    });

    // Re-create only remaining recipients
    await prisma.campaignRecipient.createMany({
      data: recipients.map(r => ({
        campaignId: Number(campaignId),
        email: r.email,
        status: r.status || "pending",
        accountId: r.accountId ? Number(r.accountId) : null,
        sentBodyHtml: r.sentBodyHtml || "",
        sentSubject: r.sentSubject || "",
        sentFromEmail: r.sentFromEmail || ""
      }))
    });

    console.log(`✅ Updated recipients for campaign ${campaignId}: ${recipients.length} recipients saved`);

    return res.json({ 
      success: true,
      message: `Successfully updated ${recipients.length} recipients`
    });

  } catch (err) {
    console.error("Update followup recipients error:", err);
    return res.status(500).json({ 
      success: false,
      message: err.message || "Failed to update recipients"
    });
  }
};


export const sendFollowupCampaign = async (req, res) => {
  try {
    const campaignId = Number(req.params.id);

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "sending" }
    });

    sendBulkCampaign(campaignId);

    return res.json({ success: true });

  } catch (err) {
    res.status(500).json({ success: false });
  }
};