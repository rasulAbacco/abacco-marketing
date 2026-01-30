import PageHeader from "../../components/layout/PageHeader";

export default function FollowUpRules() {
  return (
    <div className="space-y-6">
      <PageHeader title="Followups" subtitle="Automation & reminder rules" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card title="Active Rules" value="5" />
        <Card title="Avg Followups" value="2.1" />
        <Card title="Auto Stops" value="43" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Section title="Followup Rules" desc="Rule builder will be here." span />
        <Section title="Best Practices" desc="2–3 followups gives best deliverability." />
      </div>
    </div>
  );
}

const Card = ({ title, value }) => (
  <div className="bg-white dark:bg-[#0f172a] border border-slate-200 dark:border-slate-700 p-6 rounded-2xl">
    <p className="text-sm text-slate-500 dark:text-slate-400">{title}</p>
    <h2 className="text-3xl font-bold mt-2 text-slate-900 dark:text-white">{value}</h2>
  </div>
);

const Section = ({ title, desc, span }) => (
  <div className={`${span ? "xl:col-span-2" : ""} bg-white dark:bg-[#0f172a] border border-slate-200 dark:border-slate-700 p-6 rounded-2xl`}>
    <h3 className="font-semibold mb-2 text-slate-900 dark:text-white">{title}</h3>
    <p className="text-sm text-slate-600 dark:text-slate-400">{desc}</p>
  </div>
);
