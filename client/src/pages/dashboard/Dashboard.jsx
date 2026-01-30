import PageHeader from "../../components/layout/PageHeader";
import { Mail, Users, Megaphone, TrendingUp, Send, Inbox, CheckCircle, AlertCircle, ArrowRight, Target, Calendar } from "lucide-react";

export default function Dashboard() {
  return (
    <div className="space-y-8 pb-8">

      {/* Header */}
      <PageHeader
        title="Dashboard"
        subtitle="Overview of your CRM performance"
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        <StatCard title="Total Leads" value="2,450" icon={<Users />} trend="+12%" />
        <StatCard title="Emails Sent Today" value="186" icon={<Mail />} trend="+8%" />
        <StatCard title="Active Campaigns" value="12" icon={<Megaphone />} trend="+3" />
        <StatCard title="Reply Rate" value="18.4%" icon={<TrendingUp />} trend="+2.1%" />
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* Campaign Performance */}
        <div className="xl:col-span-2 bg-white dark:bg-slate-900 border dark:border-slate-800 rounded-2xl p-6 shadow-sm hover:shadow-md transition">
          <h3 className="font-semibold text-lg mb-6 dark:text-white flex items-center gap-2">
            <Target className="w-5 h-5 text-green-600" />
            Campaign Performance
          </h3>

          <div className="space-y-4">
            <ProgressRow label="Sent" value={82} />
            <ProgressRow label="Delivered" value={74} />
            <ProgressRow label="Opened" value={41} />
            <ProgressRow label="Replied" value={18} />
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white dark:bg-slate-900 border dark:border-slate-800 rounded-2xl p-6 shadow-sm hover:shadow-md transition">
          <h3 className="font-semibold text-lg mb-6 dark:text-white flex items-center gap-2">
            <Inbox className="w-5 h-5 text-green-600" />
            Recent Activity
          </h3>

          <ul className="space-y-4 text-sm">
            <ActivityItem 
              icon={<Send className="w-4 h-4" />}
              text="Email sent to John (USA)"
              time="2m ago"
            />
            <ActivityItem 
              icon={<Mail className="w-4 h-4" />}
              text="Reply received from Maria"
              time="15m ago"
            />
            <ActivityItem 
              icon={<Megaphone className="w-4 h-4" />}
              text="Campaign launched: SaaS Leads"
              time="1h ago"
            />
            <ActivityItem 
              icon={<AlertCircle className="w-4 h-4" />}
              text="Bounce detected (lead@example.com)"
              time="2h ago"
              alert
            />
          </ul>
        </div>
      </div>

      {/* Additional Sections */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        
        {/* Top Performing Leads */}
        <div className="bg-white dark:bg-slate-900 border dark:border-slate-800 rounded-2xl p-6 shadow-sm hover:shadow-md transition">
          <h3 className="font-semibold text-lg mb-6 dark:text-white flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-green-600" />
            Top Performing Leads
          </h3>

          <div className="space-y-4">
            <LeadRow name="Sarah Johnson" company="TechCorp" score={95} />
            <LeadRow name="Michael Chen" company="StartupXYZ" score={88} />
            <LeadRow name="Emily Davis" company="InnovateLabs" score={82} />
            <LeadRow name="David Wilson" company="CloudSys Inc" score={76} />
          </div>
        </div>

        {/* Upcoming Follow-ups */}
        <div className="bg-white dark:bg-slate-900 border dark:border-slate-800 rounded-2xl p-6 shadow-sm hover:shadow-md transition">
          <h3 className="font-semibold text-lg mb-6 dark:text-white flex items-center gap-2">
            <Calendar className="w-5 h-5 text-green-600" />
            Upcoming Follow-ups
          </h3>

          <div className="space-y-4">
            <FollowUpItem 
              name="Alex Martinez"
              task="Schedule demo call"
              time="Today, 3:00 PM"
              priority="high"
            />
            <FollowUpItem 
              name="Jessica Brown"
              task="Send pricing proposal"
              time="Tomorrow, 10:00 AM"
              priority="medium"
            />
            <FollowUpItem 
              name="Robert Taylor"
              task="Follow-up email"
              time="Jan 15, 2:00 PM"
              priority="low"
            />
          </div>
        </div>
      </div>

      {/* Navigation Buttons */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4">
        <NavButton 
          title="Campaigns"
          description="Manage your email campaigns"
          icon={<Megaphone className="w-6 h-6" />}
          href="/campaigns"
        />
        <NavButton 
          title="Leads"
          description="View and manage all leads"
          icon={<Users className="w-6 h-6" />}
          href="/leads"
        />
        <NavButton 
          title="Follow-ups"
          description="Track scheduled follow-ups"
          icon={<CheckCircle className="w-6 h-6" />}
          href="/followups"
        />
      </div>
    </div>
  );
}

/* --- Components --- */

function StatCard({ title, value, icon, trend }) {
  return (
    <div className="bg-white dark:bg-slate-900 border dark:border-slate-800 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all">
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{title}</p>
        <div className="text-green-600 dark:text-green-400">{icon}</div>
      </div>
      <h2 className="text-3xl font-bold dark:text-white mb-1">{value}</h2>
      <p className="text-xs text-green-600 dark:text-green-500 font-medium">{trend} this week</p>
    </div>
  );
}

function ProgressRow({ label, value }) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-2">
        <span className="text-slate-600 dark:text-slate-400 font-medium">{label}</span>
        <span className="font-semibold dark:text-white">{value}%</span>
      </div>
      <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-2.5">
        <div
          className="bg-gradient-to-r from-green-600 to-emerald-500 h-2.5 rounded-full transition-all"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

function ActivityItem({ icon, text, time, alert }) {
  return (
    <li className="flex items-start gap-3 group">
      <div className={`mt-0.5 ${alert ? 'text-red-500' : 'text-green-600 dark:text-green-400'}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-slate-700 dark:text-slate-300 truncate">{text}</p>
        <span className="text-xs text-slate-400 dark:text-slate-500">{time}</span>
      </div>
    </li>
  );
}

function LeadRow({ name, company, score }) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition">
      <div>
        <p className="font-medium text-slate-900 dark:text-white">{name}</p>
        <p className="text-sm text-slate-500 dark:text-slate-400">{company}</p>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-16 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
          <div 
            className="h-full bg-green-600 rounded-full"
            style={{ width: `${score}%` }}
          />
        </div>
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-300 w-8 text-right">{score}</span>
      </div>
    </div>
  );
}

function FollowUpItem({ name, task, time, priority }) {
  const priorityColors = {
    high: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    low: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
  };

  return (
    <div className="flex items-start justify-between p-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition">
      <div className="flex-1">
        <p className="font-medium text-slate-900 dark:text-white">{name}</p>
        <p className="text-sm text-slate-600 dark:text-slate-400">{task}</p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{time}</p>
      </div>
      <span className={`text-xs px-2 py-1 rounded-full font-medium ${priorityColors[priority]}`}>
        {priority}
      </span>
    </div>
  );
}

function NavButton({ title, description, icon, href }) {
  return (
    <a
      href={href}
      className="group bg-gradient-to-br from-green-50 to-emerald-50 dark:from-slate-800 dark:to-slate-900 border border-green-100 dark:border-slate-700 rounded-2xl p-6 hover:shadow-lg hover:scale-105 transition-all duration-200"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="text-green-600 dark:text-green-400">
          {icon}
        </div>
        <ArrowRight className="w-5 h-5 text-slate-400 group-hover:text-green-600 dark:group-hover:text-green-400 group-hover:translate-x-1 transition-all" />
      </div>
      <h4 className="text-lg font-bold text-slate-900 dark:text-white mb-1">{title}</h4>
      <p className="text-sm text-slate-600 dark:text-slate-400">{description}</p>
    </a>
  );
}