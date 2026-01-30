// client/src/pages/campaigns/CampaignList.jsx
import { useState, useEffect } from "react";
import {
  LayoutDashboard,
  Send,
  UserPlus,
  Users,
  TrendingUp,
  Mail, 
  Calendar,
  Activity,
  BarChart3,
  RefreshCw,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import CreateCampaign from "./campaignPages/CreateCampaign";
import CampaignDetail from "./campaignPages/CampaignDetail";
import { api } from "../utils/api";

export default function CampaignList() {
  const [activeTab, setActiveTab] = useState("dashboard");

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20">
      {/* Modern Header with Gradient */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-slate-200/60 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
                <Mail className="text-white" size={20} />
              </div>
              <div>
                <h1 className="text-xl font-bold bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent">
                  Campaign Manager
                </h1>
                <p className="text-xs text-slate-500">Manage your email campaigns</p>
              </div>
            </div>
          </div>
          
          {/* Tab Navigation */}
          <div className="flex gap-1 -mb-px">
            <TabButton
              active={activeTab === "dashboard"}
              onClick={() => setActiveTab("dashboard")}
              icon={<LayoutDashboard size={18} />}
              label="Dashboard"
            />
            <TabButton
              active={activeTab === "campaign"}
              onClick={() => setActiveTab("campaign")}
              icon={<Send size={18} />}
              label="Campaign"
            />
            <TabButton
              active={activeTab === "followup"}
              onClick={() => setActiveTab("followup")}
              icon={<UserPlus size={18} />}
              label="Follow-ups"
            />
          </div>
        </div>
      </div>

      {/* Tab Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {activeTab === "dashboard" && <DashboardTab />}
        {activeTab === "campaign" && <CreateCampaign />}
        {activeTab === "followup" && <CampaignDetail />}
      </div>
    </div>
  );
}

const CampaignProgress = ({ campaignId }) => {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    fetchProgress();
    const i = setInterval(fetchProgress, 5000);
    return () => clearInterval(i);
  }, []);

  const fetchProgress = async () => {
    const res = await api.get(`/api/campaigns/${campaignId}/progress`);
    if (res.data.success) setRows(res.data.data);
  };

  return (
    <div className="mt-4 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-100">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="text-blue-600" size={16} />
        <h4 className="text-sm font-semibold text-slate-700">Live Progress</h4>
      </div>
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gradient-to-r from-slate-50 to-slate-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Email</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Domain</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Processing</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Completed</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">ETA</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(r => (
              <tr key={r.email} className="hover:bg-slate-50 transition">
                <td className="px-4 py-3 text-slate-700">{r.email}</td>
                <td className="px-4 py-3 text-slate-600">{r.domain}</td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                    {r.processing}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                    {r.completed}
                  </span>
                </td>
                <td>
                  <span className="inline-flex px-2 py-1 rounded bg-purple-100 text-purple-700 text-xs">
                  {r.eta}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const TabButton = ({ active, onClick, icon, label }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-6 py-3 rounded-t-xl transition-all duration-200 ${
      active
        ? "bg-white text-blue-600 font-semibold shadow-sm"
        : "text-slate-500 hover:text-slate-700 hover:bg-white/50"
    }`}
  >
    {icon}
    <span className="text-sm">{label}</span>
  </button>
);

const DashboardTab = () => {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [stats, setStats] = useState({
    totalCampaigns: 0,
    totalRecipients: 0,
    totalFollowups: 0,
    followupEmails: 0
  });
  const [filter, setFilter] = useState("today");
  const [customDate, setCustomDate] = useState("");
  const [search, setSearch] = useState("");


  useEffect(() => {
    fetchCampaigns();

    const interval = setInterval(() => {
      fetchCampaigns();
    }, 60000); // refresh every 1 minute

    return () => clearInterval(interval);
  }, []);

const fetchCampaigns = async () => {
  try {
    setLoading(true);

    const params = {};

    if (customDate) {
      params.date = customDate;
    } else {
      params.range = filter;
    }

    const response = await api.get("/api/campaigns/dashboard", { params });

    if (response.data.success) {
      const { stats, recentCampaigns } = response.data.data;
      setStats(stats);
      setCampaigns(recentCampaigns);
    }

  } catch (err) {
    setError("Failed to fetch campaigns");
  } finally {
    setLoading(false);
  }
};


const handleDelete = async (id) => {
  try {
    // First try normal delete
    await api.delete(`/api/campaigns/${id}`);
    fetchCampaigns();
    alert("Campaign deleted successfully");
  } catch (err) {
    const data = err.response?.data;

    // If backend says force required
    if (data?.requireForce) {
      const ok = window.confirm(
        "This campaign is currently sending.\n\nDo you want to FORCE DELETE it?"
      );

      if (!ok) return;

      // Force delete
      await api.delete(`/api/campaigns/${id}?force=true`);
      fetchCampaigns();
      alert("Campaign force deleted successfully");
      return;
    }

    alert(data?.message || "Delete failed");
  }
};



  const toggleRow = (campaignId) => {
    setExpandedRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(campaignId)) {
        newSet.delete(campaignId);
      } else {
        newSet.add(campaignId);
      }
      return newSet;
    });
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="w-16 h-16 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-2xl flex items-center justify-center mb-4 animate-pulse">
          <RefreshCw className="text-white animate-spin" size={24} />
        </div>
        <div className="text-slate-600 font-medium">Loading campaigns...</div>
        <div className="text-sm text-slate-400 mt-1">Please wait a moment</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mb-4">
          <Activity className="text-red-600" size={24} />
        </div>
        <div className="text-red-600 font-semibold mb-2">Unable to Load Campaigns</div>
        <div className="text-slate-500 text-sm mb-6">{error}</div>
        <button 
          onClick={fetchCampaigns}
          className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl hover:from-blue-700 hover:to-indigo-700 transition-all shadow-lg shadow-blue-500/25 font-medium"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
   {/* Header */}
<div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 w-full">

  {/* Title */}
  <div>
    <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent">
      Campaign Dashboard
    </h1>
    <p className="text-slate-500 mt-1 text-sm">
      Track and manage all your email campaigns
    </p>
  </div>

  {/* Controls */}
  <div className="flex flex-wrap items-center gap-2 justify-end">

    {/* Filters */}
    <div className="flex items-center bg-white border border-slate-200 rounded-xl p-1 shadow-sm">
      <button
        onClick={() => { setFilter("today"); setCustomDate(""); }}
        className={`px-3 py-1.5 text-sm rounded-lg transition ${
          filter === "today"
            ? "bg-blue-600 text-white shadow"
            : "hover:bg-slate-100 text-slate-600"
        }`}
      >
        Today
      </button>

      <button
        onClick={() => { setFilter("week"); setCustomDate(""); }}
        className={`px-3 py-1.5 text-sm rounded-lg transition ${
          filter === "week"
            ? "bg-blue-600 text-white shadow"
            : "hover:bg-slate-100 text-slate-600"
        }`}
      >
        Week
      </button>

      <button
        onClick={() => { setFilter("month"); setCustomDate(""); }}
        className={`px-3 py-1.5 text-sm rounded-lg transition ${
          filter === "month"
            ? "bg-blue-600 text-white shadow"
            : "hover:bg-slate-100 text-slate-600"
        }`}
      >
        Month
      </button>
    </div>

    {/* Date */}
    <input
      type="date"
      value={customDate}
      onChange={(e) => setCustomDate(e.target.value)}
      className="border border-slate-200 px-3 py-2 rounded-xl text-sm shadow-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
    />

    {/* Apply */}
    <button
      onClick={fetchCampaigns}
      className="px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition shadow-sm"
    >
      Apply
    </button>

    {/* Search */}
    <div className="relative">
      <input
        type="text"
        placeholder="Search campaign..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="pl-4 pr-4 py-2 w-56 border border-slate-200 rounded-xl text-sm shadow-sm focus:ring-2 focus:ring-blue-500 focus:outline-none hover:border-slate-300 transition"
      />
    </div>

    {/* Refresh */}
    <button
      onClick={fetchCampaigns}
      className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 hover:shadow transition-all shadow-sm text-sm font-medium"
    >
      <RefreshCw size={16} />
      Refresh
    </button>
  </div>
</div>


      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          icon={<Send size={24} />}
          label="Total Campaigns"
          value={stats.totalCampaigns}
          gradient="from-blue-500 to-blue-600"
          bgGradient="from-blue-50 to-blue-100/50"
          iconBg="bg-blue-100"
          iconColor="text-blue-600"
        />

        <StatCard
          icon={<Users size={24} />}
          label="Total Recipients"
          value={stats.totalRecipients}
          gradient="from-emerald-500 to-emerald-600"
          bgGradient="from-emerald-50 to-emerald-100/50"
          iconBg="bg-emerald-100"
          iconColor="text-emerald-600"
        />

        <StatCard
          icon={<UserPlus size={24} />}
          label="Total Follow-ups"
          value={stats.totalFollowups}
          gradient="from-violet-500 to-violet-600"
          bgGradient="from-violet-50 to-violet-100/50"
          iconBg="bg-violet-100"
          iconColor="text-violet-600"
        />

        <StatCard
          icon={<TrendingUp size={24} />}
          label="Follow-up Emails"
          value={stats.followupEmails}
          gradient="from-amber-500 to-amber-600"
          bgGradient="from-amber-50 to-amber-100/50"
          iconBg="bg-amber-100"
          iconColor="text-amber-600"
        />
      </div>

      {/* Recent Campaigns - Modern Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-slate-100/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-slate-700 to-slate-800 rounded-xl flex items-center justify-center">
                <BarChart3 className="text-white" size={20} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">Recent Campaigns</h2>
                <p className="text-xs text-slate-500">Your latest campaign activities</p>
              </div>
            </div>
            <div className="text-sm text-slate-500 font-medium">
              {campaigns.length} {campaigns.length === 1 ? 'campaign' : 'campaigns'}
            </div>
          </div>
        </div>
        
        {campaigns.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <div className="w-20 h-20 bg-gradient-to-br from-slate-100 to-slate-200 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Send className="text-slate-400" size={32} />
            </div>
            <h3 className="text-lg font-semibold text-slate-700 mb-2">No campaigns yet</h3>
            <p className="text-slate-500">Create your first campaign to get started with email outreach</p>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[650px] overflow-y-auto">
            <table className="w-full">
              <thead className="sticky top-0 bg-white z-10">

                <tr className="bg-gradient-to-r from-slate-50 to-slate-100/50 border-b border-slate-200">
                  <th className="px-6 py-4 text-left">
                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Campaign Name</span>
                  </th>
                  <th className="px-6 py-4 text-left">
                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Status</span>
                  </th>
                  <th className="px-6 py-4 text-left">
                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Recipients</span>
                  </th>
                  <th className="px-6 py-4 text-left">
                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Date</span>
                  </th>
                  <th className="px-6 py-4 text-center">
                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {campaigns
                  .filter(campaign =>
                    campaign.name?.toLowerCase().includes(search.toLowerCase())
                  )
                  .map((campaign) => {
                  const isScheduled = campaign.status === "scheduled";
                  const isCompleted = campaign.status === "completed";

                  const type =
                    campaign.sendType === "followup"
                      ? "Follow-up"
                      : isScheduled
                      ? "Scheduled"
                      : isCompleted
                      ? "Completed"
                      : "Draft";


                  const date = isScheduled && campaign.scheduledAt
                      ? (() => {
                          const d = new Date(campaign.scheduledAt);

                          const datePart = d.toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          });

                          const timePart = d.toLocaleTimeString("en-US", {
                            hour: "numeric",
                            minute: "2-digit",
                            hour12: true,
                          });

                          return `${datePart} at ${timePart}`;
                        })()
                      : campaign.createdAt
                      ? new Date(campaign.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })
                      : "—";



                  const isExpanded = expandedRows.has(campaign.id);

                  const statusConfig = {
                    sending: {
                      bg: "bg-blue-100",
                      text: "text-blue-700",
                      border: "border-blue-200",
                      icon: <Activity size={14} className="animate-pulse" />
                    },
                    scheduled: {
                      bg: "bg-indigo-100",
                      text: "text-indigo-700",
                      border: "border-indigo-200",
                      icon: <Calendar size={14} />
                    },
                    completed: {
                      bg: "bg-emerald-100",
                      text: "text-emerald-700",
                      border: "border-emerald-200",
                      icon: <TrendingUp size={14} />
                    },
                    draft: {
                      bg: "bg-amber-100",
                      text: "text-amber-700",
                      border: "border-amber-200",
                      icon: <Mail size={14} />
                    },
                  };

                  const config = statusConfig[campaign.status] || statusConfig.draft;

                  return (
                    <>
                      <tr key={campaign.id} className="hover:bg-slate-50/70 transition-colors group">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-lg ${config.bg} flex items-center justify-center flex-shrink-0`}>
                              <Mail className={config.text} size={18} />
                            </div>
                            <div>
                              <h3 className="font-semibold text-slate-900 text-sm"> {campaign.name?.replace(/\s*\(\d+\)\s*$/, "")}</h3>

                              {campaign.fromNames?.length > 0 && (
                                <p className="text-xs text-slate-500 mt-0.5">
                                  {campaign.fromNames.join(", ")}
                                </p>
                              )}
                           
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border ${config.border} ${config.bg} ${config.text} font-medium text-xs`}>
                            {config.icon}
                            {type}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <Users size={16} className="text-slate-400" />
                            <span className="text-sm font-semibold text-slate-900">
                              {(campaign.recipients?.length || 0).toLocaleString()}
                            </span>
                            <span className="text-xs text-slate-500">recipients</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <Calendar size={16} className="text-slate-400" />
                            <span className="text-sm text-slate-700">{date}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center gap-4 flex justify-center">
                          {campaign.status !== "draft" && (
                            <button
                              onClick={() => toggleRow(campaign.id)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors text-xs font-medium"
                            >
                              {isExpanded ? (
                                <>
                                  <ChevronUp size={14} />
                                  Hide
                                </>
                              ) : (
                                <>
                                  <ChevronDown size={14} />
                                  Show
                                </>
                              )}
                            </button>
                          )}
                            <button
                              onClick={() => handleDelete(campaign.id)}
                              className="px-3 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700"
                            >
                              Delete
                            </button>

                        </td>
                      </tr>
                      {isExpanded && campaign.status !== "draft" && (
                        <tr>
                          <td colSpan={5} className="px-6 py-0 bg-slate-50/30">
                            <div className="py-4">
                              {campaign.status === "sending" && (
                                <CampaignProgress campaignId={campaign.id} />
                              )}

                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

const StatCard = ({ icon, label, value, gradient, bgGradient, iconBg, iconColor }) => (
  <div className="group relative">
    <div className="absolute inset-0 bg-gradient-to-br opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl blur-xl -z-10" 
         style={{ background: `linear-gradient(135deg, var(--tw-gradient-stops))` }} />
    <div className={`bg-white rounded-2xl p-6 border border-slate-200 hover:border-slate-300 transition-all shadow-sm hover:shadow-md`}>
      <div className="flex items-start justify-between mb-4">
        <div className={`w-12 h-12 ${iconBg} rounded-xl flex items-center justify-center`}>
          <div className={iconColor}>{icon}</div>
        </div>
      </div>
      <div>
        <p className="text-sm font-medium text-slate-500 mb-1">{label}</p>
        <p className="text-3xl font-bold text-slate-900">{value}</p>
      </div>
    </div>
  </div>
);