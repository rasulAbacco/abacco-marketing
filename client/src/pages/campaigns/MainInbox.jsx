import React, { useState, useEffect } from "react";
import ModernSidebar from "./components/LeftSidebar.jsx";
import InboxHeader from "./components/Inboxheader.jsx";
import ConversationList from "./components/EmailList.jsx";
import MessageView from "./components/EmailPreview.jsx";
import AddAccountManager from "./components/AddEmailAccount.jsx";
import ScheduleModal from "./campaignPages/Schedulemodal.jsx";
import { api } from "../utils/api.js";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export default function InboxMain() {
  // Sidebar state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Accounts state
  const [accounts, setAccounts] = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [showAddAccountModal, setShowAddAccountModal] = useState(false);

  // Selection state
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [selectedFolder, setSelectedFolder] = useState("inbox");
  const [selectedConversation, setSelectedConversation] = useState(null);

  // 🔥 Initialize activeView from localStorage
  const [activeView, setActiveView] = useState(() => {
    return localStorage.getItem("activeView") || "inbox";
  });

  // 🔥 CALCULATE DEFAULT DATE (3 MONTHS AGO)
  const getDefaultDateFrom = () => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return d.toISOString().split("T")[0];
  };

  // Filter state (With Default 3 Months)
  const [filters, setFilters] = useState({
    leadStatus: "",
    sender: "",
    recipient: "",
    subject: "",
    tags: [],
    dateFrom: getDefaultDateFrom(), // ✅ DEFAULT: 3 Months
    dateTo: "",
    hasAttachment: false,
    isUnread: false,
    isStarred: false,
    country: "",
  });

  // Search state
  const [searchEmail, setSearchEmail] = useState("");

  // Mobile state
  const [showMobileConversations, setShowMobileConversations] = useState(false);
  const [isScheduleMode, setIsScheduleMode] = useState(false);
  const [selectedConversations, setSelectedConversations] = useState([]);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(false);

  // Fetch accounts on mount
  useEffect(() => {
    fetchAccounts();
  }, []);

    useEffect(() => {
      if (!selectedAccount?.id) return;

      // 1️⃣ Fast load (cached data)
      fetchConversations(selectedAccount.id, selectedFolder);

      // 2️⃣ Auto refresh after background IMAP sync
      const timer = setTimeout(() => {
        fetchConversations(selectedAccount.id, selectedFolder);
      }, 2000); // 3–4 seconds

      return () => clearTimeout(timer);
    }, [selectedAccount?.id, selectedFolder]);


  const fetchAccounts = async () => {
    try {
      setLoadingAccounts(true);
      const response = await api.get(`${API_BASE_URL}/api/accounts`);
      const accountsData = Array.isArray(response.data?.data)
        ? response.data.data
        : [];

      const accountsWithUnread = await Promise.all(
        accountsData.map(async (account) => {
          try {
            const unreadRes = await api.get(
              `${API_BASE_URL}/api/inbox/accounts/${account.id}/unread`
            );
            return {
              ...account,
              unreadCount: unreadRes.data?.data?.inboxUnread || 0,
            };
          } catch {
            return { ...account, unreadCount: 0 };
          }
        })
      );

      setAccounts(accountsWithUnread);

      if (!selectedAccount && accountsWithUnread.length > 0) {
        setSelectedAccount(accountsWithUnread[0]);
      }
    } catch (error) {
      console.error("Error fetching accounts:", error);
      setAccounts([]);
    } finally {
      setLoadingAccounts(false);
    }
  };

  const fetchSearchResults = async () => {
    if (!searchEmail || searchEmail.trim() === "" || !selectedAccount) return;

    try {
      setLoading(true);
      const res = await api.get(`${API_BASE_URL}/api/inbox/search`, {
        params: {
          query: searchEmail,
          accountId: selectedAccount.id,
        },
      });

      const rawMessages = res.data?.data || [];
      const uniqueConversations = new Map();

      rawMessages.forEach((msg) => {
        const convId = msg.conversationId;
        if (
          !uniqueConversations.has(convId) ||
          new Date(msg.sentAt) >
            new Date(uniqueConversations.get(convId).sentAt)
        ) {
          uniqueConversations.set(convId, msg);
        }
      });

      const formattedResults = Array.from(uniqueConversations.values()).map(
        (msg) => ({
          conversationId: msg.conversationId,
          subject: msg.subject || "(No Subject)",
          initiatorEmail: msg.fromEmail,
          lastSenderEmail: msg.fromEmail,
          displayEmail:
            msg.direction === "sent"
              ? `To: ${msg.toEmail?.split(",")[0]}`
              : msg.fromEmail,
          lastDate: msg.sentAt,
          lastBody: msg.body
            ? msg.body.replace(/<[^>]*>/g, "").substring(0, 100)
            : "",
          unreadCount: 0,
          messageCount: 1,
          isStarred: false,
        })
      );

      setConversations(formattedResults);
    } catch (error) {
      console.error("Search failed:", error);
      setConversations([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchConversations = async () => {
    if (!selectedAccount) return;

    try {
      setLoading(true);
      const params = { folder: selectedFolder };

      if (filters.leadStatus) params.leadStatus = filters.leadStatus;
      if (filters.country) params.country = filters.country;
      if (filters.sender) params.sender = filters.sender;
      if (filters.recipient) params.recipient = filters.recipient;
      if (filters.subject) params.subject = filters.subject;
      if (filters.dateFrom) params.dateFrom = filters.dateFrom;
      if (filters.dateTo) params.dateTo = filters.dateTo;
      if (filters.hasAttachment) params.hasAttachment = true;
      if (filters.isUnread) params.isUnread = true;
      if (filters.isStarred) params.isStarred = true;

      const res = await api.get(
        `${API_BASE_URL}/api/inbox/conversations/${selectedAccount.id}`,
        { params }
      );

      setConversations(res.data?.data || []);
    } catch (error) {
      console.error("Failed to fetch conversations:", error);
      setConversations([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchTodayFollowUps = async () => {
    try {
      setLoading(true);
      const res = await api.get(`${API_BASE_URL}/api/scheduled-messages/today`);

      const formatted = res.data.map((msg) => {
        let actualEmail = msg.toEmail;
        if (msg.toEmail.includes("<") && msg.toEmail.includes(">")) {
          const match = msg.toEmail.match(/<(.+?)>/);
          if (match && match[1]) {
            actualEmail = match[1];
          }
        }

        return {
          conversationId: msg.conversationId,
          subject: msg.subject || "(No subject)",
          displayName: actualEmail,
          displayEmail: actualEmail,
          primaryRecipient: actualEmail,
          lastDate: msg.sendAt,
          lastBody: "(Scheduled follow-up)",
          unreadCount: 0,
          isScheduled: true,
          scheduledMessageId: msg.id,
          scheduledMessageData: msg,
        };
      });

      setConversations(formatted);
    } catch (err) {
      console.error("❌ Failed to fetch today follow-ups", err);
      setConversations([]);
    } finally {
      setLoading(false);
    }
  };

  // Auto-load based on activeView
  useEffect(() => {
    if (!selectedAccount) return;

    if (activeView === "today") {
      fetchTodayFollowUps();
      return;
    }

    if (searchEmail && searchEmail.trim() !== "") {
      fetchSearchResults();
    } else {
      fetchConversations();
    }
  }, [selectedAccount, selectedFolder, activeView, filters, searchEmail]);

  // Helper to update view and persist it
  const changeView = (view) => {
    setActiveView(view);
    localStorage.setItem("activeView", view);
  };

  const handleAccountSelect = (account) => {
    setSelectedAccount(account);
    setSelectedFolder("inbox");  // ✅ reset folder
    setSearchEmail("");          // ✅ reset search
    setSelectedConversation(null);
    setShowMobileConversations(true);
    changeView("inbox");
  };


  const handleFolderSelect = (folder) => {
    setSelectedFolder(folder);
    setSearchEmail("");          // ✅ clear search
    setSelectedConversation(null);
    setShowMobileConversations(true);
    changeView("inbox");
  };


  const handleConversationSelect = (conversation) => {
    setSelectedConversation(conversation);
  };

  const handleFilterApply = (newFilters) => {
    changeView("inbox");
    setFilters(newFilters);
  };

  const handleSearchEmail = (email) => {
    setSearchEmail(email);
  };

  const handleAddAccount = () => {
    setShowAddAccountModal(true);
  };

  const handleTodayFollowUp = async () => {
    changeView("today");
    setFilters({
      leadStatus: "",
      sender: "",
      recipient: "",
      subject: "",
      tags: [],
      dateFrom: "",
      dateTo: "",
      hasAttachment: false,
      isUnread: false,
      isStarred: false,
      country: "",
    });
  };

  const handleSchedule = () => {
    setIsScheduleMode(true);
    // Do NOT clear selectedConversations here, or the modal will receive an empty array
  };

  // 🔥 Callback when a message is successfully sent
  const handleMessageSent = (conversationId) => {
    if (activeView === "today") {
      setConversations((prev) =>
        prev.filter((c) => c.conversationId !== conversationId)
      );
      if (selectedConversation?.conversationId === conversationId) {
        setSelectedConversation(null);
      }
    } else {
      fetchConversations();
    }
  };

  // 🔥 NEW: Handle when schedule modal closes successfully
  const handleScheduleSuccess = () => {
    setShowScheduleModal(false);
    setIsScheduleMode(false);
    setSelectedConversations([]);

    // If we're in "today" view, refresh the list
    if (activeView === "today") {
      fetchTodayFollowUps();
    }
  };

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <ModernSidebar
        accounts={accounts}
        selectedAccount={selectedAccount}
        selectedFolder={selectedFolder}
        onAccountSelect={handleAccountSelect}
        onFolderSelect={handleFolderSelect}
        onAddAccount={handleAddAccount}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={setSidebarCollapsed}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <InboxHeader
          selectedAccount={selectedAccount}
          selectedFolder={selectedFolder}
          onFilterApply={handleFilterApply}
          onSearchEmail={handleSearchEmail}
          onTodayFollowUpClick={handleTodayFollowUp}
          onScheduleClick={handleSchedule}
          activeView={activeView}
          // 🔥 PASS ACTIVE FILTERS TO HEADER
          activeFilters={filters}
        />

        {isScheduleMode && (
          <div className="px-4 py-3 border-b bg-blue-50 flex items-center justify-between">
            <span className="text-sm text-gray-700">
              {selectedConversations.length} selected
            </span>
            <div className="flex gap-2">
              <button
                disabled={selectedConversations.length === 0}
                onClick={() => setShowScheduleModal(true)}
                className="px-4 py-1.5 bg-blue-600 text-white rounded disabled:opacity-50"
              >
                Schedule
              </button>
              <button
                onClick={() => {
                  setIsScheduleMode(false);
                  setSelectedConversations([]);
                }}
                className="px-4 py-1.5 border rounded"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* emailList page */}

        <div className="flex-1 flex overflow-hidden">
          <div
              className={`${
                selectedConversation ? "hidden lg:flex" : "flex"
              } w-full lg:w-96 flex-col`}
            >
              <ConversationList
                key={`${selectedAccount?.id}-${selectedFolder}`} // ✅ GOOD
                conversations={conversations}
                selectedConversation={selectedConversation}
                onConversationSelect={handleConversationSelect}
                activeView={activeView}
                selectedAccount={selectedAccount}
                selectedFolder={selectedFolder}
                setConversations={setConversations}
              />
            </div>


          <div
            className={`${
              selectedConversation ? "flex" : "hidden lg:flex"
            } flex-1 flex-col`}
          >
            <MessageView
              selectedAccount={selectedAccount}
              selectedConversation={selectedConversation}
              selectedFolder={selectedFolder}
              onBack={() => setSelectedConversation(null)}
              onMessageSent={handleMessageSent}
            />
          </div>
        </div>
      </div>

      {showAddAccountModal && (
        <AddAccountManager
          onClose={() => {
            setShowAddAccountModal(false);
            fetchAccounts();
          }}
          onAccountAdded={fetchAccounts}
        />
      )}

      {/* 🔥 FIXED: Pass isOpen prop and use handleScheduleSuccess */}
      {showScheduleModal && (
        <ScheduleModal
          isOpen={showScheduleModal}
          selectedAccount={selectedAccount}
          selectedConversations={selectedConversations}
          onClose={handleScheduleSuccess}
        />
      )}
    </div>
  );
}
 