import React, { useState, useRef, useEffect } from "react";
import { Mail, Search, RefreshCcw } from "lucide-react";

export default function InboxHeader({
  selectedAccount,
  selectedFolder,
  onSearchEmail,
  onRefresh,
}) {
  const [searchEmail, setSearchEmail] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const searchTimeoutRef = useRef(null);

  const handleSearchChange = (e) => {
    const value = e.target.value;
    setSearchEmail(value);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      if (onSearchEmail) onSearchEmail(value);
    }, 500);
  };

  return (
    <div className="bg-white/80 backdrop-blur-xl border-b border-emerald-200/50 px-6 py-3 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        {/* Left Side */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-500 to-green-600 rounded-xl blur opacity-50"></div>
              <div className="relative w-10 h-10 bg-gradient-to-br from-emerald-600 to-green-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/30">
                <Mail className="text-white" size={18} />
              </div>
            </div>
            <div>
              <h1 className="text-lg font-bold bg-gradient-to-r from-emerald-600 to-green-600 bg-clip-text text-transparent">
                {selectedFolder
                  ? selectedFolder.charAt(0).toUpperCase() +
                    selectedFolder.slice(1)
                  : "Inbox"}
              </h1>
              {selectedAccount && (
                <p className="text-xs text-slate-600 font-medium">
                  {selectedAccount.email}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Right Side */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setIsRefreshing(true);
              onRefresh();

              // Stop rotation after 1 second
              setTimeout(() => setIsRefreshing(false), 1000);
            }}
            className="bg-green-200 flex items-center gap-2 px-3 py-1.5 text-sm border rounded hover:bg-green-250"
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

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-emerald-400" />
        <input
          type="text"
          placeholder="Search by email ID..."
          value={searchEmail}
          onChange={handleSearchChange}
          className="w-full pl-10 pr-4 py-2 border border-emerald-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent bg-white/80 backdrop-blur-sm placeholder-slate-400"
        />
      </div>
    </div>
  );
}
