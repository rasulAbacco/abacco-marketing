// ✅ EmailList.jsx  
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
      for (const conv of selectedConversations) {
        await api.patch(`${API_BASE_URL}/api/inbox/hide-inbox-conversation`, {
          conversationId: conv.conversationId,
          accountId: selectedAccount.id,
        });
      }

      setConversations((prev) =>
        prev.filter((c) => !selectedConversations.some((sc) => sc.conversationId === c.conversationId))
      );
      setSelectedConversations([]);
      setSelectAll(false);
      setSelectionMode(false);
      setShowMoreMenu(false);
      onUnreadChange?.(); 
    } catch (err) {
      console.error("Failed to delete:", err);
      alert("Failed to delete conversations");
    }
  };

  const handleDeleteAll = async () => {
    if (conversations.length === 0) return;
    
    if (!confirm(`Delete all ${conversations.length} conversation(s)?`)) return;

    try {
      for (const conv of conversations) {
        await api.patch(`${API_BASE_URL}/api/inbox/hide-inbox-conversation`, {
          conversationId: conv.conversationId,
          accountId: selectedAccount.id,
        });
      }

      setConversations([]);
      setSelectedConversations([]);
      setSelectAll(false);
      setSelectionMode(false);
      setShowMoreMenu(false);
      onUnreadChange?.(); 
    } catch (err) {
      console.error("Failed to delete all:", err);
      alert("Failed to delete all conversations");
    }
  };

  const handleMarkAsRead = async () => {
    if (selectedConversations.length === 0) return;

    try {
      for (const conv of selectedConversations) {
        await api.patch(`${API_BASE_URL}/api/inbox/conversations/${conv.conversationId}/read`);
      }

      setConversations((prev) =>
        prev.map((c) =>
          selectedConversations.some((sc) => sc.conversationId === c.conversationId)
            ? { ...c, unreadCount: 0 }
            : c
        )
      );
      setSelectedConversations([]);
      setSelectAll(false);
      setSelectionMode(false);
      setShowMoreMenu(false);
      onUnreadChange?.(); 
    } catch (err) {
      console.error("Failed to mark as read:", err);
      alert("Failed to mark as read");
    }
  };

  const handleMarkAsUnread = async () => {
    if (selectedConversations.length === 0) return;

    try {
      // Note: You'll need to create this endpoint in your backend
      for (const conv of selectedConversations) {
        await api.patch(`${API_BASE_URL}/api/inbox/conversations/${conv.conversationId}/unread`);
      }

      setConversations((prev) =>
        prev.map((c) =>
          selectedConversations.some((sc) => sc.conversationId === c.conversationId)
            ? { ...c, unreadCount: 1 }
            : c
        )
      );
      setSelectedConversations([]);
      setSelectAll(false);
      setSelectionMode(false);
      setShowMoreMenu(false);
      onUnreadChange?.();
    } catch (err) {
      console.error("Failed to mark as unread:", err);
      alert("Failed to mark as unread");
    }
  };

  const toggleSectionCollapse = (sectionName) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [sectionName]: !prev[sectionName],
    }));
  };

  // Date grouping functions
  const getDateGroup = (date) => {
    const now = new Date();
    const messageDate = new Date(date);
    
    // Reset time to midnight for accurate comparison
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const msgDay = new Date(messageDate.getFullYear(), messageDate.getMonth(), messageDate.getDate());
    
    const diffTime = today - msgDay;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    
    // Get day name for this week
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    if (diffDays >= 2 && diffDays <= 6) {
      return dayNames[messageDate.getDay()];
    }
    
    if (diffDays >= 7 && diffDays <= 13) return "Last Week";
    if (diffDays >= 14 && diffDays <= 27) return "Two Weeks Ago";
    if (diffDays >= 28 && diffDays <= 60) return "Last Month";
    
    return "Older";
  };

  const groupConversationsByDate = () => {
    const groups = {
      "Today": [],
      "Yesterday": [],
      "Monday": [],
      "Tuesday": [],
      "Wednesday": [],
      "Thursday": [],
      "Friday": [],
      "Saturday": [],
      "Sunday": [],
      "Last Week": [],
      "Two Weeks Ago": [],
      "Last Month": [],
      "Older": []
    };

    conversations.forEach((conv) => {
      const group = getDateGroup(conv.lastDate);
      if (groups[group]) {
        groups[group].push(conv);
      }
    });

    // Return only non-empty groups in order
    const order = [
      "Today", "Yesterday", 
      "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
      "Last Week", "Two Weeks Ago", "Last Month", "Older"
    ];
    
    return order
      .filter(key => groups[key].length > 0)
      .map(key => ({ group: key, conversations: groups[key] }));
  };

  const formatDate = (date) => {
    const messageDate = new Date(date);
    return messageDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const truncateText = (html, maxLength = 80) => {
    if (!html) return "";
    let cleanHtml = html.replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, "");
    const tmp = document.createElement("DIV");
    tmp.innerHTML = cleanHtml;
    let cleanText = tmp.textContent || tmp.innerText || "";
    cleanText = cleanText.replace(/\s+/g, " ").trim();
    return cleanText.length > maxLength ? cleanText.substring(0, maxLength) + "..." : cleanText;
  };

  const getAvatarLetter = (name) => {
    if (!name) return "?";
    const cleanName = name.replace(/^[^a-zA-Z0-9]+/, "");
    return cleanName.charAt(0).toUpperCase() || "?";
  };

  const handleConversationSelect = async (conversation) => {
    onConversationSelect(conversation);

    try {
      await api.patch(`${API_BASE_URL}/api/inbox/conversations/${conversation.conversationId}/read`);
      setConversations((prev) =>
        prev.map((c) =>
          c.conversationId === conversation.conversationId ? { ...c, unreadCount: 0 } : c
        )
      );
    } catch (err) {
      console.error("Failed to mark read:", err);
    }
  };

  if (!selectedAccount?.id || !selectedFolder) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500">
        <p className="text-sm">Select an account and folder to view messages</p>
      </div>
    );
  }

  const groupedConversations = groupConversationsByDate();

  return (
    <div className="flex flex-col h-full bg-white/80 backdrop-blur-sm border-r border-emerald-200/50">
      <div className="border-b border-emerald-200/50 px-4 py-3 flex items-center justify-between bg-gradient-to-r from-emerald-50/50 to-teal-50/50">
        <div className="flex items-center gap-2">
          {selectionMode && (
            <input
              type="checkbox"
              checked={selectAll}
              onChange={handleTopCheckboxChange}
              className="accent-emerald-600 cursor-pointer w-4 h-4"
              title="Select all conversations"
            />
          )}
          <h3 className="text-sm font-bold text-emerald-700">
            {conversations.length} Conversation{conversations.length !== 1 ? "s" : ""}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleSort("sender")}
            className={`text-xs px-3 py-1 rounded-lg font-medium transition-all ${
              sortBy === "sender"
                ? "bg-gradient-to-r from-emerald-100 to-teal-100 text-emerald-700 border border-emerald-200 shadow-sm"
                : "text-slate-600 hover:bg-gradient-to-r hover:from-emerald-50 hover:to-teal-50"
            } flex items-center gap-1`}
          >
            {selectedFolder === "sent" ? "Recipient" : "Sender"}
            {sortBy === "sender" && (sortOrder === "desc" ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />)}
          </button>
          
          {/* More Menu */}
          <div className="relative" ref={moreMenuRef}>
            <button
              onClick={() => setShowMoreMenu(!showMoreMenu)}
              className="text-xs px-3 py-1 rounded-lg font-medium transition-all text-slate-600 hover:bg-gradient-to-r hover:from-emerald-50 hover:to-teal-50 flex items-center gap-1"
            >
              <MoreVertical className="w-4 h-4" />
            </button>
            
            {showMoreMenu && (
              <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-xl border border-emerald-200 py-2 z-50">
                <button
                  onClick={handleSelectAll}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-emerald-50 flex items-center gap-2 text-slate-700"
                >
                  {selectionMode ? (
                    <>
                      <X className="w-4 h-4 text-emerald-600" />
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
                  Mark as Read
                </button>
                
                <button
                  onClick={handleMarkAsUnread}
                  disabled={selectedConversations.length === 0}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-emerald-50 flex items-center gap-2 text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Mail className="w-4 h-4 text-blue-600" />
                  Mark as Unread
                </button>
              </div>
            )}
          </div>
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