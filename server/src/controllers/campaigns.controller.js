import prisma from "../prisma.js";
import { sendBulkCampaign } from "../services/campaignMailer.service.js";
import cache from "../utils/cache.js";

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
      scheduledAt
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
      // normal campaigns
      try {
        JSON.parse(campaign.fromAccountIds || "[]")
          .forEach(id => locked.add(Number(id)));
      } catch {}

      // followup campaigns
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


    // 3️⃣ PROVIDER LIMIT VALIDATION (SAFE SENDING)
    const accounts = await prisma.emailAccount.findMany({
      where: { id: { in: fromAccountIds } }
    });

    const SAFE_LIMITS = {
      gmail: 50,
      gsuite: 80,
      rediff: 40,
      amazon: 60,
      custom: 60
    };

    let totalCapacity = 0;

    for (const acc of accounts) {
      const key = (acc.provider || "custom").toLowerCase();
      totalCapacity += SAFE_LIMITS[key] || SAFE_LIMITS.custom;
    }

    if (recipients.length > totalCapacity) {
      return res.status(400).json({
        success: false,
        message: `You selected ${accounts.length} account(s) with total safe limit ${totalCapacity} emails. You added ${recipients.length}. Please remove some emails or add more From accounts.`
      });
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
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        status: sendType === "scheduled" ? "scheduled" : "draft",

        subject: JSON.stringify(subjects),
        fromAccountIds: JSON.stringify(fromAccountIds),
        pitchIds: JSON.stringify(pitchIds || []),

        recipients: {
          create: recipients.map((email, i) => ({
            email,
            status: "pending",
            accountId: fromIds[i % fromIds.length],
          })),
        },
      },
    });





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
      return res.status(404).json({ success: false, message: "Campaign not found" });
    }

    if (campaign.status === "sending") {
      return res.status(400).json({
        success: false,
        message: "Campaign is already sending"
      });
    }

    // 🔒 LOCK CHECK BEFORE SENDING
    const activeCampaigns = await prisma.campaign.findMany({
      where: {
        status: "sending",
        NOT: { id: campaignId }
      }
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

    // ✅ SAFE TO SEND
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "sending" }

    });

    sendBulkCampaign(campaignId);

    return res.json({ success: true });

  } catch (err) {
    console.error("Send campaign error:", err);
      res.status(500).json({
        success: false,
        message: "Failed to send campaign"
      });
  }
};
 

/**
 * Schedule Campaign
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

    // 1️⃣ FIRST: load base campaign
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

    // 2️⃣ BACKFILL accountId for legacy recipients (SAFE PLACE)
    if (baseCampaign.sendType !== "followup") {
      let fromAccountIds = [];
      try {
        fromAccountIds = JSON.parse(baseCampaign.fromAccountIds || "[]");
      } catch {}

      if (fromAccountIds.length) {
        for (let i = 0; i < baseCampaign.recipients.length; i++) {
          const r = baseCampaign.recipients[i];

          if (!r.accountId) {
            await prisma.campaignRecipient.update({
              where: { id: r.id },
              data: {
                accountId: fromAccountIds[i % fromAccountIds.length],
              }
            });
          }
        }
      }
    }

    // 3️⃣ Build recipients for follow-up (accountId is now guaranteed)
    const recipientsToCreate = [];

    Object.entries(senderRecipientMap).forEach(([accountId, emails]) => {
      emails.forEach(email => {
        recipientsToCreate.push({
          email,
          accountId: Number(accountId),
          status: "pending"
        });
      });
    });

    if (!recipientsToCreate.length) {
      return res.status(400).json({
        success: false,
        message: "No valid recipients found for follow-up"
      });
    }

    // 🔒 LOCK CHECK for follow-up (prevent double use of same account)
const sendingCampaigns = await prisma.campaign.findMany({
  where: { status: "sending" },
  include: {
    recipients: { select: { accountId: true } }
  }
});

const locked = new Set();

for (const c of sendingCampaigns) {
  try {
    JSON.parse(c.fromAccountIds || "[]")
      .forEach(id => locked.add(Number(id)));
  } catch {}

  c.recipients.forEach(r => {
    if (r.accountId) locked.add(Number(r.accountId));
  });
}

// Collect accounts used by this followup
const followupAccounts = Object.keys(senderRecipientMap).map(Number);

const conflict = followupAccounts.find(id => locked.has(id));

if (conflict) {
  return res.status(400).json({
    success: false,
    message: "This email account is already sending another campaign. Please wait until it completes."
  });
}


    // 4️⃣ Create follow-up campaign
    const newCampaign = await prisma.campaign.create({
      data: {
        userId: req.user.id,
        name: `Follow-up: ${baseCampaign.name} (${Date.now()})`,
        bodyHtml,
        subject: JSON.stringify(subjects),
        sendType: "followup",
        status: "sending",
        parentCampaignId: baseCampaignId,
        recipients: {
          create: recipientsToCreate
        }
      }
    });

    // 5️⃣ Send emails
    sendBulkCampaign(newCampaign.id);

    return res.json({ success: true });

  } catch (err) {
    console.error("Follow-up error:", err);
    return res.status(500).json({
      success: false,
      message: "Follow-up failed"
    });
  }
};

export const deleteCampaign = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const force = req.query.force === "true";

    const campaign = await prisma.campaign.findUnique({
      where: { id }
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found"
      });
    }

    // If sending and NOT force → block
    if (campaign.status === "sending" && !force) {
      return res.status(400).json({
        success: false,
        requireForce: true,
        message: "Campaign is currently sending"
      });
    }

    // Delete recipients
    await prisma.campaignRecipient.deleteMany({
      where: { campaignId: id }
    });

    // Delete campaign
    await prisma.campaign.delete({
      where: { id }
    });

    return res.json({
      success: true,
      message: force
        ? "Campaign force deleted successfully"
        : "Campaign deleted successfully"
    });

  } catch (err) {
    console.error("Delete campaign error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to delete campaign"
    });
  }
};
export const scheduleCampaign = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { scheduledAt } = req.body;

    if (!scheduledAt) {
      return res.status(400).json({
        success: false,
        message: "scheduledAt is required",
      });
    }

    const updated = await prisma.campaign.update({
      where: { id },
      data: {
        status: "scheduled",
        scheduledAt: new Date(scheduledAt),
      },
    });

    res.json({ success: true, data: updated });

  } catch (err) {
    console.error("Schedule error:", err);
    res.status(500).json({ success: false });
  }
};



export const getAllCampaigns = async (req, res) => {
  try {
    const cacheKey = `campaigns:${req.user.id}`;
    const cached = cache.get(cacheKey);

    if (cached) {
      console.log("🟢 CACHE HIT: getAllCampaigns");
      return res.json({ success: true, data: cached });
    }

    const campaigns = await prisma.campaign.findMany({
      where: {
        userId: req.user.id,
        status: "completed",
        parentCampaignId: null,

        // 👇 ADD THIS LINE (24 hour delay rule)
        createdAt: {
          lte: new Date(Date.now() - 24 * 60 * 60 * 1000)
        }
      },
      orderBy: { createdAt: "desc" },
      include: { recipients: true }
    });


    const followups = await prisma.campaign.findMany({
      where: {
        userId: req.user.id,
        parentCampaignId: { not: null }
      },
      select: { parentCampaignId: true }
    });

    const usedParentIds = new Set(followups.map(f => f.parentCampaignId));

    const filtered = campaigns.filter(
      c => !usedParentIds.has(c.id)
    );

    // ✅ store in cache AFTER calculation
    cache.set(cacheKey, filtered, 60);

    return res.json({ success: true, data: filtered });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
};

  
export const getDashboardCampaigns = async (req, res) => {
  try {
    const { range, date } = req.query;

    const cacheKey = `dashboard:${req.user.id}:${range || "all"}:${date || "none"}`;
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

    const campaigns = await prisma.campaign.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { recipients: true }
    });

    // =========================
    // 📊 CAMPAIGN COUNTS
    // =========================
    const totalCampaigns = campaigns.filter(
      c => c.sendType !== "followup"
    ).length;

    const followups = campaigns.filter(c => c.sendType === "followup");
    const totalFollowups = followups.length;
    const followupEmails = followups.reduce(
      (sum, c) => sum + (c.recipients?.length || 0),
      0
    );

    // =========================
    // 📧 RECIPIENT COUNTS
    // =========================
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

    // =========================
    // 🧾 RECENT CAMPAIGNS
    // =========================
    const recentCampaigns = [];

    for (const campaign of campaigns) {
      let fromNames = [];

      try {
        const ids = JSON.parse(campaign.fromAccountIds || "[]");

        if (ids.length) {
          const accounts = await prisma.emailAccount.findMany({
            where: { id: { in: ids } },
            select: { email: true }
          });

          fromNames = accounts.map(
            acc => acc.email.split("@")[0] + "@"
          );
        }
      } catch {}

      recentCampaigns.push({
        ...campaign,
        fromNames
      });
    }

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

    // ✅ Cache after full calculation
    cache.set(cacheKey, responseData, 60);

    return res.json({ success: true, data: responseData });

  } catch (err) {
    console.error("Dashboard error:", err);
    res.status(500).json({ success: false });
  }
};




export const getCampaignProgress = async (req, res) => {
  try {
    const id = Number(req.params.id);

    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        recipients: true
      }
    });

    if (!campaign) {
      return res.status(404).json({ success: false });
    }

    // Same limits used in mailer
    const SAFE_LIMITS = {
      gmail: 50,
      gsuite: 80,
      rediff: 40,
      amazon: 60,
      custom: 60
    };

    // helper to format time nicely
    function formatDuration(ms) {
      const totalMinutes = Math.ceil(ms / 60000);
      const h = Math.floor(totalMinutes / 60);
      const m = totalMinutes % 60;
      if (h > 0) return `${h}h ${m}m`;
      return `${m}m`;
    }

    const grouped = {};

    for (const r of campaign.recipients) {
      if (!r.accountId) continue;

      const account = await prisma.emailAccount.findUnique({
        where: { id: r.accountId }
      });

      if (!account) continue;

      const key = account.email;

      if (!grouped[key]) {
        grouped[key] = {
          email: account.email,
          domain: account.provider,
          processing: 0,
          completed: 0,
          eta: "0m"
        };
      }

      if (r.status === "pending") grouped[key].processing++;
      if (r.status === "sent") grouped[key].completed++;
    }

    // Calculate ETA for each account
    for (const row of Object.values(grouped)) {
      const provider = (row.domain || "custom").toLowerCase();
      const limit = SAFE_LIMITS[provider] || SAFE_LIMITS.custom;

      // exactly same throttle math as mailer
      const delayPerMail = (2 * 60 * 60 * 1000) / limit;
      const remainingMs = row.processing * delayPerMail;

      row.eta = formatDuration(remainingMs);
    }

    res.json({ success: true, data: Object.values(grouped) });

  } catch (err) {
    console.error("Progress API error:", err);
    res.status(500).json({ success: false });
  }
};

export const getLockedAccounts = async (req, res) => {
  try {
    const cacheKey = `locked:${req.user.id}`;
    const cached = cache.get(cacheKey);
    if (cached) {
        console.log("🟢 CACHE HIT: getLockedAccounts");
        return res.json({ success: true, data: cached });
    }


    const sendingCampaigns = await prisma.campaign.findMany({
      where: {status: "sending"  },
      include: {
        recipients: {
          select: { accountId: true }
        }
      }
    });

    const locked = new Set();

    for (const campaign of sendingCampaigns) {
      // fromAccountIds (normal campaign)
      try {
        JSON.parse(campaign.fromAccountIds || "[]")
          .forEach(id => locked.add(Number(id)));
      } catch {}

      // recipients.accountId (followup campaign)
      campaign.recipients.forEach(r => {
        if (r.accountId) locked.add(Number(r.accountId));
      });
    }

    cache.set(cacheKey, Array.from(locked), 15);
    return res.json({
      success: true,
      data: Array.from(locked)
    });

  } catch (err) {
    console.error("getLockedAccounts error:", err);
    res.status(500).json({ success: false });
  }
};






