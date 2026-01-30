import React, { useState, useRef, useEffect } from "react";
import {
  Filter,
  Calendar,
  Clock,
  ChevronDown,
  X,
  Tag, 
  User,
  Mail,
  Search,
  Globe,
  RefreshCcw,
} from "lucide-react";
import { api } from "../../utils/api.js";
 
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export default function InboxHeader({
  selectedAccount,
  selectedFolder,
  onScheduleClick,
  onSearchEmail,
}) {

  const [searchEmail, setSearchEmail] = useState("");


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
    <div className="bg-white border-b border-gray-200 px-6 py-3">
      <div className="flex items-center justify-between mb-3">
        {/* Left Side */}
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">
              {selectedFolder
                ? selectedFolder.charAt(0).toUpperCase() +
                  selectedFolder.slice(1)
                : "Inbox"}
            </h1>
            {selectedAccount && (
              <p className="text-xs text-gray-500">{selectedAccount.email}</p>
            )}
          </div>
        </div>

        {/* Right Side */}
        <div className="flex items-center gap-2">
          <button
           
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium text-gray-700"
          >
            <Clock className="w-4 h-4" />
            add Schedule
          </button>

         
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search by email ID..."
          value={searchEmail}
          onChange={handleSearchChange}
          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>
 
    </div>
  );
}
