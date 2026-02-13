// ✅ EmailList.jsx - FIXED VERSION
import React, { useState, useEffect, useRef } from "react";
import { Mail, ChevronDown, ChevronUp, Users, Globe, Zap, MoreVertical, Trash2, Check, X } from "lucide-react";
import { api } from "../../utils/api"; 

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export default function ConversationList({ 
  selectedAccount,
  selectedFolder,
  onConversationSelect,
  selectedConversation,
  filters = {},
  searchEmail = "",
  isScheduleMode = false,
  selectedConversations = [],
  setSelectedConversations,
  conversations,
  setConversations,
  refreshKey,
  onUnreadChange,
}) {
  const [sortBy, setSortBy] = useState("sender");
  const [sortOrder, setSortOrder] = useState("desc");
  const [loading, setLoading] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [selectAll, setSelectAll] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState({});
  const moreMenuRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target)) {
        setShowMoreMenu(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchEmails = async () => {
    if (!selectedAccount?.id) {
      console.warn("No account ID available");
      return;
    }

    setLoading(true);
    try {
      const res = await api.get(
        `${API_BASE_URL}/api/inbox/conversations/${selectedAccount.id}`,
        {
          params: {
            folder: selectedFolder,
          },
        }
      );

      setConversations(res.data.data || []);
    } catch (err) {
      console.error("Failed to fetch emails", err);
      setConversations([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedAccount?.id || !selectedFolder) return;

    fetchEmails();

    const interval = setInterval(() => {
      fetchEmails();
    }, 60000);

    return () => clearInterval(interval);
  }, [refreshKey, selectedAccount?.id, selectedFolder]);

  useEffect(() => {
    console.log(`📊 EmailList rendered with ${conversations.length} conversations`);
  }, [conversations]);

  if (loading) return <p className="p-4 text-center text-green-700 mt-20">Refreshing inbox...</p>;

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortOrder("desc");
    }

    const sorted = [...conversations].sort((a, b) => {
      let compareA, compareB;

      switch (field) {
        case "sender":
          compareA = (a.primaryRecipient || a.initiatorEmail || "").toLowerCase();
          compareB = (b.primaryRecipient || b.initiatorEmail || "").toLowerCase();
          break;
        case "subject":
          compareA = (a.subject || "").toLowerCase();
          compareB = (b.subject || "").toLowerCase();
          break;
        default:
          return 0;
      }

      if (sortOrder === "asc") {
        return compareA > compareB ? 1 : -1;
      } else {
        return compareA < compareB ? 1 : -1;
      }
    });

    setConversations(sorted);
  };

  const toggleSelectConversation = (conversation) => {
    setSelectedConversations((prev) => {
      const exists = prev.some((c) => c.conversationId === conversation.conversationId);
      let newSelected;
      if (exists) {
        newSelected = prev.filter((c) => c.conversationId !== conversation.conversationId);
      } else {
        newSelected = [...prev, conversation];
      }
      
      // Update selectAll based on whether all conversations are selected
      if (newSelected.length === conversations.length) {
        setSelectAll(true);
      } else {
        setSelectAll(false);
      }
      
      return newSelected;
    });
  };

  const handleSelectAll = () => {
    if (selectionMode) {
      // Exit selection mode and clear selections
      setSelectedConversations([]);
      setSelectAll(false);
      setSelectionMode(false);
    } else {
      // Enter selection mode but don't auto-select
      setSelectionMode(true);
    }
  };

  const handleTopCheckboxChange = () => {
    if (selectAll) {
      // Deselect all
      setSelectedConversations([]);
      setSelectAll(false);
    } else {
      // Select all
      setSelectedConversations([...conversations]);
      setSelectAll(true);
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedConversations.length === 0) return;
    
    if (!confirm(`Delete ${selectedConversations.length} conversation(s)?`)) return;

    try {
      // ✅ BATCH DELETE - all at once instead of loop
      const conversationIds = selectedConversations.map(c => c.conversationId);
      
      await api.patch(`${API_BASE_URL}/api/inbox/batch-hide-conversations`, {
        conversationIds,
        accountId: selectedAccount.id,
      });

      setConversations((prev) =>
        prev.filter((c) => !selectedConversations.some((sc) => sc.conversationId === c.conversationId))
      );
      setSelectedConversations([]);
      setSelectAll(false);
      setSelectionMode(false);
      setShowMoreMenu(false);
      
      // ✅ Trigger unread count refresh
      if (onUnreadChange) {
        onUnreadChange();
      }
    } catch (err) {
      console.error("Delete failed:", err);
      alert("Failed to delete conversations");
    }
  };

  const handleDeleteAll = async () => {
    if (conversations.length === 0) return;
    
    if (!confirm(`Delete all ${conversations.length} conversations?`)) return;

    try {
      // ✅ BATCH DELETE ALL
      const conversationIds = conversations.map(c => c.conversationId);
      
      await api.patch(`${API_BASE_URL}/api/inbox/batch-hide-conversations`, {
        conversationIds,
        accountId: selectedAccount.id,
      });

      setConversations([]);
      setSelectedConversations([]);
      setSelectAll(false);
      setSelectionMode(false);
      setShowMoreMenu(false);
      
      // ✅ Trigger unread count refresh
      if (onUnreadChange) {
        onUnreadChange();
      }
    } catch (err) {
      console.error("Delete all failed:", err);
      alert("Failed to delete all conversations");
    }
  };

  // ✅ OPTIMIZED: Batch mark as read
  const handleMarkAsRead = async () => {
    if (selectedConversations.length === 0) return;

    try {
      const conversationIds = selectedConversations.map(c => c.conversationId);
      
      // ✅ Use batch endpoint
      await api.patch(`${API_BASE_URL}/api/inbox/batch-mark-read`, {
        conversationIds,
        accountId: selectedAccount.id,
      });

      // Update local state
      setConversations((prev) =>
        prev.map((conv) => {
          if (selectedConversations.some((sc) => sc.conversationId === conv.conversationId)) {
            return { ...conv, unreadCount: 0 };
          }
          return conv;
        })
      );

      setSelectedConversations([]);
      setSelectAll(false);
      setSelectionMode(false);
      setShowMoreMenu(false);
      
      // ✅ CRITICAL: Trigger unread count refresh in sidebar
      if (onUnreadChange) {
        onUnreadChange();
      }
    } catch (err) {
      console.error("Mark as read failed:", err);
      alert("Failed to mark conversations as read");
    }
  };

  // ✅ OPTIMIZED: Batch mark as unread
  const handleMarkAsUnread = async () => {
    if (selectedConversations.length === 0) return;

    try {
      const conversationIds = selectedConversations.map(c => c.conversationId);
      
      // ✅ Use batch endpoint
      await api.patch(`${API_BASE_URL}/api/inbox/batch-mark-unread`, {
        conversationIds,
        accountId: selectedAccount.id,
      });

      // Update local state
      setConversations((prev) =>
        prev.map((conv) => {
          if (selectedConversations.some((sc) => sc.conversationId === conv.conversationId)) {
            return { ...conv, unreadCount: conv.messageCount || 1 };
          }
          return conv;
        })
      );

      setSelectedConversations([]);
      setSelectAll(false);
      setSelectionMode(false);
      setShowMoreMenu(false);
      
      // ✅ CRITICAL: Trigger unread count refresh in sidebar
      if (onUnreadChange) {
        onUnreadChange();
      }
    } catch (err) {
      console.error("Mark as unread failed:", err);
      alert("Failed to mark conversations as unread");
    }
  };

  const handleConversationSelect = (conversation) => {
    if (selectionMode) {
      toggleSelectConversation(conversation);
    } else {
      onConversationSelect(conversation);
    }
  };

  const toggleSectionCollapse = (group) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [group]: !prev[group],
    }));
  };

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;

    const options = { month: "short", day: "numeric" };
    if (date.getFullYear() !== now.getFullYear()) {
      options.year = "numeric";
    }
    return date.toLocaleDateString(undefined, options);
  };

  const truncateText = (text, maxLength = 60) => {
    if (!text) return "";
    return text.length > maxLength ? text.slice(0, maxLength) + "..." : text;
  };

  const getAvatarLetter = (email) => {
    return email ? email.charAt(0).toUpperCase() : "?";
  };

  const groupConversationsByDate = (conversations) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const thisWeekStart = new Date(today);
    thisWeekStart.setDate(thisWeekStart.getDate() - today.getDay());
    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);

    const groups = {
      Today: [],
      Yesterday: [],
      "This Week": [],
      "Last Week": [],
      Earlier: [],
    };

    conversations.forEach((conv) => {
      const convDate = new Date(conv.lastDate);
      if (convDate >= today) {
        groups.Today.push(conv);
      } else if (convDate >= yesterday) {
        groups.Yesterday.push(conv);
      } else if (convDate >= thisWeekStart) {
        groups["This Week"].push(conv);
      } else if (convDate >= lastWeekStart) {
        groups["Last Week"].push(conv);
      } else {
        groups.Earlier.push(conv);
      }
    });

    return Object.entries(groups)
      .filter(([_, convs]) => convs.length > 0)
      .map(([group, conversations]) => ({ group, conversations }));
  };

  const groupedConversations = groupConversationsByDate(conversations);

  return (
    <div className="flex flex-col h-full bg-white/90 backdrop-blur-sm">
      {/* Header */}
      <div className="p-2 border-b border-emerald-200/50 bg-gradient-to-r from-white to-emerald-50/30">
        <div className="flex items-center justify-between ">
          <h2 className="text-md font-bold bg-gradient-to-r from-emerald-600 to-green-800 bg-clip-text text-transparent">
          {conversations.length} {conversations.length === 1 ? "conversation" : "conversations"}
          </h2>

          {/* More Menu - Top Right */}
          <div className="relative" ref={moreMenuRef}>
            <button
              onClick={() => setShowMoreMenu(!showMoreMenu)}
              className="p-2 hover:bg-emerald-100 rounded-lg transition-colors"
              title="More options"
            >
              <MoreVertical className="w-5 h-5 text-emerald-600" />
            </button>

            {showMoreMenu && (
              <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-xl border border-emerald-200 z-50">
                <button
                  onClick={handleSelectAll}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-emerald-50 flex items-center gap-2 text-slate-700"
                >
                  {selectionMode ? (
                    <>
                      <X className="w-4 h-4 text-red-600" />
                      Cancel Selection
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4 text-emerald-600" />
                      Select
                    </>
                  )}
                </button>
                
                <div className="border-t border-slate-200 my-1"></div>
                
                <button
                  onClick={handleDeleteSelected}
                  disabled={selectedConversations.length === 0}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-emerald-50 flex items-center gap-2 text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-4 h-4 text-red-600" />
                  Delete Selected ({selectedConversations.length})
                </button>
                
                <button
                  onClick={handleDeleteAll}
                  disabled={conversations.length === 0}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-emerald-50 flex items-center gap-2 text-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete All
                </button>
                
                <div className="border-t border-slate-200 my-1"></div>
                
                <button
                  onClick={handleMarkAsRead}
                  disabled={selectedConversations.length === 0}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-emerald-50 flex items-center gap-2 text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Mail className="w-4 h-4 text-emerald-600" />
                  Mark as Read ({selectedConversations.length})
                </button>
                
                <button
                  onClick={handleMarkAsUnread}
                  disabled={selectedConversations.length === 0}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-emerald-50 flex items-center gap-2 text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Mail className="w-4 h-4 text-blue-600" />
                  Mark as Unread ({selectedConversations.length})
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Sorting and Select All */}
        <div className="flex items-center justify-between gap-2">
          

          {selectionMode && (
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={selectAll}
                onChange={handleTopCheckboxChange}
                className="accent-emerald-600"
              />
              <span className="font-medium">Select All</span>
            </label>
          )}
        </div>
         
      </div>

      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 p-8">
            <div className="relative mb-4">
              <div className="absolute inset-0 bg-emerald-200/20 rounded-full blur-xl"></div>
              <Mail className="relative w-12 h-12 text-emerald-300" />
            </div>
            <p className="text-sm font-medium">No conversations found</p>
            {(searchEmail || Object.values(filters).some((v) => v && v !== "all" && v !== "")) && (
              <p className="text-xs mt-2 text-slate-400">Try adjusting your filters</p>
            )}
          </div>
        ) : (
          groupedConversations.map(({ group, conversations: groupConvs }) => (
            <div key={group}>
              {/* Date Section Header - Collapsible */}
              <div 
                className="sticky top-0 bg-gradient-to-r from-slate-100 to-slate-50 px-4 py-2 border-b border-slate-200 z-10 cursor-pointer hover:bg-slate-200/50 transition-colors flex items-center justify-between"
                onClick={() => toggleSectionCollapse(group)}
              >
                <h4 className="text-xs font-bold text-slate-600 uppercase tracking-wide flex items-center gap-2">
                  {collapsedSections[group] ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronUp className="w-4 h-4" />
                  )}
                  {group}
                </h4>
                <span className="text-xs text-slate-500">
                  {groupConvs.length} {groupConvs.length === 1 ? 'conversation' : 'conversations'}
                </span>
              </div>
              
              {/* Conversations in this group - Only show if not collapsed */}
              {!collapsedSections[group] && groupConvs.map((conversation) => {
                const conversationId = conversation.conversationId;
                const isSelected = selectedConversation?.conversationId === conversationId;
                const clientEmail = conversation.displayName?.trim() ? conversation.displayName : conversation.displayEmail || "Unknown";
                const hasMultipleParticipants = false;
                const isChecked = selectedConversations.some((c) => c.conversationId === conversation.conversationId);

                return (
                  <div
                    key={conversationId}
                    onClick={() => handleConversationSelect(conversation)}
                    className={`px-4 py-3 border-b border-emerald-100/50 cursor-pointer transition-all ${
                      isSelected
                        ? "bg-gradient-to-r from-emerald-50 to-teal-50 border-l-4 border-emerald-600 shadow-sm"
                        : "hover:bg-gradient-to-r hover:from-emerald-50/50 hover:to-teal-50/50"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Checkbox - Only show in selection mode */}
                      {selectionMode && (
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            e.stopPropagation();
                            toggleSelectConversation(conversation);
                          }}
                          className="mt-2 accent-emerald-600 cursor-pointer"
                        />
                      )}

                      <div className="relative w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500 to-green-600 rounded-full blur opacity-50"></div>
                        <div className="relative w-10 h-10 bg-gradient-to-br from-emerald-600 to-green-600 rounded-full flex items-center justify-center shadow-md shadow-emerald-500/30">
                          {hasMultipleParticipants ? <Users className="w-5 h-5" /> : getAvatarLetter(clientEmail)}
                        </div>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span className={`text-sm truncate ${conversation.unreadCount > 0 ? "font-bold text-slate-900" : "font-semibold text-slate-700"}`}>
                              {clientEmail}
                              {hasMultipleParticipants && (
                                <span className="text-slate-400 text-[10px] ml-1 font-normal">+{conversation.participants.length - 1} more</span>
                              )}
                            </span>
                            {conversation.isCrmLead && (
                              <span className="flex-shrink-0 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-gradient-to-r from-emerald-100 to-teal-100 text-emerald-700 border border-emerald-200 uppercase tracking-tighter shadow-sm" title="This lead exists in your CRM">
                                <Zap className="w-2.5 h-2.5 fill-emerald-700" />
                                CRM
                              </span>
                            )}
                            {conversation.unreadCount > 0 && (
                              <span className="flex-shrink-0 w-2 h-2 bg-emerald-600 rounded-full shadow-sm"></span>
                            )}
                          </div>
                          <span className="text-xs text-slate-500 flex-shrink-0 ml-2 font-medium">
                            {formatDate(conversation.lastDate)}
                          </span>
                        </div>

                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm mb-0.5 truncate ${conversation.unreadCount > 0 ? "font-medium text-slate-800" : "text-slate-600"}`}>
                              {conversation.subject || "(No subject)"}
                            </p>
                            <p className="text-xs text-slate-400 line-clamp-1 italic">{truncateText(conversation.lastBody)}</p>
                          </div>
                        </div>

                        <div className="mt-2 flex items-center gap-2 flex-wrap">
                          {conversation.unreadCount > 0 && (
                            <span className="text-[10px] font-bold text-emerald-700 bg-gradient-to-r from-emerald-100 to-teal-100 px-1.5 py-0.5 rounded-full uppercase border border-emerald-200 shadow-sm">
                              {conversation.unreadCount} New
                            </span>
                          )}
                          {conversation.messageCount > 1 && (
                            <span className="text-[10px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded-full font-medium border border-slate-200">
                              {conversation.messageCount} msgs
                            </span>
                          )}
                          {conversation.country && (
                            <span className="text-[10px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded-full flex items-center gap-1 font-medium border border-slate-200">
                              <Globe className="w-2.5 h-2.5" />
                              {conversation.country}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}