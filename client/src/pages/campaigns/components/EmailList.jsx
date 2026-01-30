// 
import React, { useState } from "react";
import { Mail, ChevronDown, ChevronUp, Users, Globe, Zap } from "lucide-react";
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
  activeView,
}) {
  const [sortBy, setSortBy] = useState("date");
  const [sortOrder, setSortOrder] = useState("desc");

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
        case "date":
          compareA = new Date(a.lastDate);
          compareB = new Date(b.lastDate);
          break;
        case "sender":
          compareA = (
            a.primaryRecipient ||
            a.initiatorEmail ||
            ""
          ).toLowerCase();
          compareB = (
            b.primaryRecipient ||
            b.initiatorEmail ||
            ""
          ).toLowerCase();
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
      const exists = prev.some(
        (c) => c.conversationId === conversation.conversationId
      );

      if (exists) {
        return prev.filter(
          (c) => c.conversationId !== conversation.conversationId
        );
      }

      return [...prev, conversation];
    });
  };

  const formatDate = (date) => {
    const now = new Date();
    const messageDate = new Date(date);
    const diffMs = now - messageDate;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return messageDate.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    } else if (diffDays === 1) {
      return "Yesterday";
    } else if (diffDays < 7) {
      return messageDate.toLocaleDateString([], { weekday: "short" });
    } else {
      return messageDate.toLocaleDateString([], {
        month: "short",
        day: "numeric",
      });
    }
  };

  const truncateText = (html, maxLength = 80) => {
    if (!html) return "";
    let cleanHtml = html.replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, "");
    const tmp = document.createElement("DIV");
    tmp.innerHTML = cleanHtml;
    let cleanText = tmp.textContent || tmp.innerText || "";
    cleanText = cleanText.replace(/\s+/g, " ").trim();
    return cleanText.length > maxLength
      ? cleanText.substring(0, maxLength) + "..."
      : cleanText;
  };

  // 🔥 NEW: Helper to get a clean avatar letter (ignores quotes/symbols)
  const getAvatarLetter = (name) => {
    if (!name) return "?";
    // Remove any character that is NOT a letter or number from the start
    // e.g., "'Abacco Tech'" -> "Abacco Tech" -> "A"
    const cleanName = name.replace(/^[^a-zA-Z0-9]+/, "");
    return cleanName.charAt(0).toUpperCase() || "?";
  };

  const handleConversationSelect = async (conversation) => {
    onConversationSelect(conversation);

    try {
      await api.patch(
        `${API_BASE_URL}/api/inbox/conversations/${conversation.conversationId}/read`
      );

      setConversations((prev) =>
        prev.map((c) =>
          c.conversationId === conversation.conversationId
            ? { ...c, unreadCount: 0 }
            : c
        )
      );
    } catch (err) {
      console.error("Failed to mark read:", err);
    }
  };



  if (!selectedAccount || !selectedFolder) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        <p className="text-sm">Select an account and folder to view messages</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white border-r border-gray-200">
      {/* Sort Header */}
      <div className="border-b border-gray-200 px-4 py-3 flex items-center justify-between bg-gray-50">
        <h3 className="text-sm font-semibold text-gray-700">
          {conversations.length} Conversation
          {conversations.length !== 1 ? "s" : ""}
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleSort("date")}
            className={`text-xs px-3 py-1 rounded ${
              sortBy === "date"
                ? "bg-blue-100 text-blue-700"
                : "text-gray-600 hover:bg-gray-100"
            } flex items-center gap-1`}
          >
            Date
            {sortBy === "date" &&
              (sortOrder === "desc" ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronUp className="w-3 h-3" />
              ))}
          </button>
          <button
            onClick={() => handleSort("sender")}
            className={`text-xs px-3 py-1 rounded ${
              sortBy === "sender"
                ? "bg-blue-100 text-blue-700"
                : "text-gray-600 hover:bg-gray-100"
            } flex items-center gap-1`}
          >
            {selectedFolder === "sent" ? "Recipient" : "Sender"}
            {sortBy === "sender" &&
              (sortOrder === "desc" ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronUp className="w-3 h-3" />
              ))}
          </button>
        </div>
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 p-8">
            <Mail className="w-12 h-12 opacity-20 mb-4" />
            <p className="text-sm">No conversations found</p>
            {(searchEmail ||
              Object.values(filters).some(
                (v) => v && v !== "all" && v !== ""
              )) && <p className="text-xs mt-2">Try adjusting your filters</p>}
          </div>
        ) : (
          conversations.map((conversation) => {
            const conversationId = conversation.conversationId;
            const isSelected =
              selectedConversation?.conversationId === conversationId;

            const clientEmail = conversation.displayName?.trim()
              ? conversation.displayName
              : conversation.displayEmail || "Unknown";

            const hasMultipleParticipants = false;

            return (
              <div
                key={conversation.conversationId || conversation.id}
                onClick={() => {
                  handleConversationSelect(conversation);
                }}
                className={`px-4 py-3 border-b border-gray-100 transition-colors
                  ${
                    isSelected && !isScheduleMode
                      ? "bg-blue-50 border-l-4 border-l-blue-600"
                      : ""
                  }
                  ${
                    !isScheduleMode
                      ? "cursor-pointer hover:bg-gray-50"
                      : "cursor-default bg-blue-50/20"
                  }
                  ${conversation.unreadCount > 0 ? "bg-blue-50/30" : ""}
                `}
              >
                <div className="flex items-start gap-3">
                  {isScheduleMode && (
                    <input
                      type="checkbox"
                      checked={selectedConversations.some(
                        (c) => c.conversationId === conversation.conversationId
                      )}
                      onChange={(e) => {
                        e.stopPropagation();
                        // 🔥 CRITICAL: Pass the FULL conversation object
                        toggleSelectConversation(conversation);
                      }}
                      className="mt-2"
                    />
                  )}

                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-sm font-semibold flex-shrink-0 shadow-sm">
                    {hasMultipleParticipants ? (
                      <Users className="w-5 h-5" />
                    ) : (
                      // 🔥 FIX: Use the clean letter generator
                      getAvatarLetter(clientEmail)
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span
                          className={`text-sm truncate ${
                            conversation.unreadCount > 0
                              ? "font-bold text-gray-900"
                              : "font-semibold text-gray-700"
                          }`}
                        >
                          {clientEmail}
                          {hasMultipleParticipants && (
                            <span className="text-gray-400 text-[10px] ml-1 font-normal">
                              +{conversation.participants.length - 1} more
                            </span>
                          )}
                        </span>
                        {/* 🔥 NEW: CRM Indicator Badge */}
                        {conversation.isCrmLead && (
                          <span
                            className="flex-shrink-0 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-100 text-indigo-700 border border-indigo-200 uppercase tracking-tighter"
                            title="This lead exists in your CRM"
                          >
                            <Zap className="w-2.5 h-2.5 fill-indigo-700" />
                            CRM
                          </span>
                        )}
                        {conversation.unreadCount > 0 && (
                          <span className="flex-shrink-0 w-2 h-2 bg-blue-600 rounded-full"></span>
                        )}
                      </div>
                      <span className="text-xs text-gray-500 flex-shrink-0 ml-2">
                        {formatDate(conversation.lastDate)}
                      </span>
                    </div>

                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-sm mb-0.5 truncate ${
                            conversation.unreadCount > 0
                              ? "font-medium text-gray-800"
                              : "text-gray-600"
                          }`}
                        >
                          {conversation.subject || "(No subject)"}
                        </p>
                        <p className="text-xs text-gray-400 line-clamp-1 italic">
                          {truncateText(conversation.lastBody)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      {conversation.unreadCount > 0 && (
                        <span className="text-[10px] font-bold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded uppercase">
                          {conversation.unreadCount} New
                        </span>
                      )}
                      {conversation.messageCount > 1 && (
                        <span className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                          {conversation.messageCount} msgs
                        </span>
                      )}
                      {conversation.country && (
                        <span className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded flex items-center gap-1">
                          <Globe className="w-2.5 h-2.5" />
                          {conversation.country}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}











// import { Search } from "lucide-react";

// function getSenderName(from) {
//   if (!from) return "Unknown";

//   // Handle: "Name" <email>
//   const match = from.match(/(.*)<(.*)>/);

//   let name = match ? match[1].trim() || match[2].trim() : from;

//   // Remove wrapping quotes if present
//   name = name.replace(/^["']|["']$/g, "");

//   return name;
// }


// function getPreview(body) {
//   if (!body) return "";
//   return body
//     .replace(/\s+/g, " ")
//     .trim()
//     .split(" ")
//     .slice(0, 6) // first 5–6 words
//     .join(" ");
// }

// export default function EmailList({ emails = [], selected, onSelect }) {
//   const safeEmails = Array.isArray(emails) ? emails : [];

//   return (
//     <div className="w-[380px] bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col text-slate-800 dark:text-slate-100">

//       {/* SEARCH BAR */}
//       <div className="p-4 border-b border-slate-200 dark:border-slate-800">
//         <div className="relative">
//           <Search
//             size={16}
//             className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
//           />
//           <input
//             placeholder="Search"
//             className="w-full pl-9 pr-3 py-2.5 rounded-lg
//               bg-slate-50 dark:bg-slate-800
//               border border-slate-200 dark:border-slate-700
//               text-sm
//               outline-none
//               focus:ring-2 focus:ring-blue-500"
//           />
//         </div>
//       </div>

//       {/* EMAIL LIST */}
//       <div className="flex-1 overflow-y-auto">
//         {safeEmails.length === 0 && (
//           <div className="p-6 text-center text-sm text-slate-400">
//             No emails found
//           </div>
//         )}

//         {safeEmails.map((mail) => {
//           const sender = getSenderName(mail.from);
//           const preview = getPreview(mail.body);

//           const date =
//             mail.receivedAt || mail.createdAt
//               ? new Date(mail.receivedAt || mail.createdAt).toLocaleDateString()
//               : "";

//           return (
//             <div
//               key={mail.id}
//               onClick={() => onSelect(mail)}
//               className={`px-4 py-3 border-b border-slate-100 dark:border-slate-800 cursor-pointer transition
//                 ${
//                   selected?.id === mail.id
//                     ? "bg-blue-50 dark:bg-slate-800"
//                     : "hover:bg-slate-50 dark:hover:bg-slate-800"
//                 }`}
//             >
//               {/* Top row: Name + Date */}
//               <div className="flex justify-between items-center">
//                 <h4 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
//                   {sender}
//                 </h4>

//                 <span className="text-xs text-slate-500 dark:text-slate-400">
//                   {date}
//                 </span>
//               </div>

//               {/* Subject */}
//               <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
//                 {mail.subject || "(No subject)"}
//               </p>

//               {/* Body preview */}
//               <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
//                 {preview}
//               </p>
//             </div>
//           );
//         })}
//       </div>
//     </div>
//   );
// }

