import React, { useState, useRef } from "react";
import { Mail, Search, RefreshCcw, CalendarDays } from "lucide-react";

// ── Month-filter options ──────────────────────────────────────────────────────
const MONTH_OPTIONS = [
  { value: "current", label: "Current Month" },
  { value: "last",    label: "Last Month"    },
  { value: "three",   label: "Last 3 Months" },
];

export default function InboxHeader({
  selectedAccount,
  selectedFolder,
  onSearchEmail,
  onRefresh,
  // ── Month filter props (NEW) ─────────────────────────────
  monthFilter = "current",
  onMonthFilterChange,
}) {
  const [searchEmail, setSearchEmail]     = useState("");
  const [isRefreshing, setIsRefreshing]   = useState(false);

  const searchTimeoutRef = useRef(null);

  // ── Search with debounce ─────────────────────────────────
  const handleSearchChange = (e) => {
    const value = e.target.value;
    setSearchEmail(value);

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      if (onSearchEmail) onSearchEmail(value);
    }, 500);
  };

  // ── Month filter change ──────────────────────────────────
  const handleMonthFilterChange = (e) => {
    if (onMonthFilterChange) onMonthFilterChange(e.target.value);
  };

  // ── Refresh with spin animation ──────────────────────────
  const handleRefresh = () => {
    setIsRefreshing(true);
    onRefresh();
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  return (
    <div className="bg-white/80 backdrop-blur-xl border-b border-emerald-200/50 px-6 py-3 shadow-sm">
      {/* ── Top row ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3">

        {/* Left – title + account email */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500 to-green-600 rounded-xl blur opacity-50" />
            <div className="relative w-10 h-10 bg-gradient-to-br from-emerald-600 to-green-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/30">
              <Mail className="text-white" size={18} />
            </div>
          </div>
          <div>
            <h1 className="text-lg font-bold bg-gradient-to-r from-emerald-600 to-green-600 bg-clip-text text-transparent">
              {selectedFolder
                ? selectedFolder.charAt(0).toUpperCase() + selectedFolder.slice(1)
                : "Inbox"}
            </h1>
            {selectedAccount && (
              <p className="text-xs text-slate-600 font-medium">
                {selectedAccount.email}
              </p>
            )}
          </div>
        </div>

        {/* Right – month filter + refresh */}
        <div className="flex items-center gap-2">

          {/* ── Month filter dropdown ── */}
          <div className="relative flex items-center gap-1.5">
            <CalendarDays
              size={15}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-emerald-500 pointer-events-none"
            />
            <select
              value={monthFilter}
              onChange={handleMonthFilterChange}
              className="
                pl-8 pr-3 py-1.5 text-sm
                border border-emerald-200 rounded-lg
                bg-white/80 text-slate-700 font-medium
                focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent
                hover:border-emerald-300 transition-colors cursor-pointer
                appearance-none
              "
              aria-label="Filter emails by month"
            >
              {MONTH_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {/* Custom chevron */}
            <svg
              className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-emerald-400 pointer-events-none"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </div>

          {/* ── Refresh button ── */}
          <button
            onClick={handleRefresh}
            className="bg-green-200 flex items-center gap-2 px-3 py-1.5 text-sm border border-green-300 rounded-lg hover:bg-green-300 transition-colors"
            aria-label="Refresh inbox"
          >
            <RefreshCcw
              size={16}
              className={`transition-transform duration-700 ${
                isRefreshing ? "rotate-[360deg]" : ""
              }`}
            />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Search bar ──────────────────────────────────────── */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-400" />
        <input
          type="text"
          placeholder="Search by email ID..."
          value={searchEmail}
          onChange={handleSearchChange}
          className="
            w-full pl-10 pr-4 py-2
            border border-emerald-200 rounded-lg text-sm
            focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent
            bg-white/80 backdrop-blur-sm placeholder-slate-400
          "
        />
      </div>
    </div>
  );
}