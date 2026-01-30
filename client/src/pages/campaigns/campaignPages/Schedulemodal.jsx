
import React, { useState, useEffect } from "react";
import { replacePlaceholders } from "../../utils/templateReplacer";
import { api } from "../../utils/api";
import {
  X,
  Clock,
  ChevronDown, 
  Trash2,
  Tag,
  CheckCircle2,
  Star,
} from "lucide-react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

// Default Statuses
const DEFAULT_STATUSES = [
  "Invoice Pending",
  "Invoice Cancel",
  "Deal",
  "Active Client",
  "No Response",
  "1 Reply",
  "1 Follow Up",
  "2 Follow Up",
  "3 Follow Up",
  "Call",
  "Sample Pending",
];

export default function EnhancedScheduleModal({
  isOpen,
  onClose,
  selectedAccount, // The account currently viewing in inbox
  selectedConversations = [], // The list of conversations passed from parent
}) {
  // --- Global State ---
  if (!isOpen) return null;

  const [accounts, setAccounts] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState(
    selectedAccount?.id || null
  );

  // --- Status & Templates ---
  const [allLeadStatuses, setAllLeadStatuses] = useState(DEFAULT_STATUSES);
  const [selectedLeadStatus, setSelectedLeadStatus] = useState("");
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);

  // --- Options ---
  const [includeSignature, setIncludeSignature] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // --- Recipients ---
  const [recipients, setRecipients] = useState([]);

  /* ============================================================
     1️⃣ INITIAL DATA FETCH
  ============================================================ */
  useEffect(() => {
    fetchAccounts();
    fetchTemplates();
    fetchCustomStatuses();
  }, []);

  /* ============================================================
     2️⃣ INITIALIZE RECIPIENTS (ROBUST EMAIL FIX)
  ============================================================ */
  useEffect(() => {
    if (!selectedConversations || selectedConversations.length === 0) {
      setRecipients([]);
      return;
    }

    const resolved = selectedConversations.map((conv) => {
      let email = "";

      // --- STRATEGY 1: Explicit Email Field ---
      if (conv.email && conv.email.includes("@")) {
        email = conv.email.trim();
      }

      // --- STRATEGY 2: Display Email (Clean up "To:" or "Name <email>") ---
      else if (conv.displayEmail) {
        let raw = conv.displayEmail.replace("To:", "").trim();
        const match = raw.match(/<(.+?)>/);
        email = match ? match[1] : raw;
      }

      // --- STRATEGY 3: Fallback to primaryRecipient / toEmail / initiator ---
      else if (conv.toEmail && conv.toEmail.includes("@")) {
        email = conv.toEmail.split(",")[0].trim();
      } else if (conv.initiatorEmail && conv.initiatorEmail.includes("@")) {
        email = conv.initiatorEmail.trim();
      } else if (conv.lastSenderEmail && conv.lastSenderEmail.includes("@")) {
        email = conv.lastSenderEmail.trim();
      }

      // --- Name Resolution ---
      let name =
        conv.displayName || conv.senderName || conv.fromName || "Client";
      if ((!name || name === "Unknown") && email) {
        name = email.split("@")[0];
      }

      return {
        conversationId: conv.conversationId,
        name: name,
        email: email,
        subject: conv.subject || "",
        body: "",
        currentStatus: conv.leadStatus || "New",
      };
    });

    // Filter valid emails
    const validRecipients = resolved.filter(
      (r) => r.email && r.email.includes("@")
    );

    setRecipients(validRecipients);

    // Set initial status
    if (validRecipients.length > 0) {
      setSelectedLeadStatus(validRecipients[0].currentStatus);
    }
  }, [selectedConversations]);

  /* ============================================================
     3️⃣ TEMPLATE REPLACEMENT LOGIC (INTEGRATED)
  ============================================================ */

  // This effect runs when:
  // 1. A Template is selected
  // 2. The Account changes (updates {sender_name})
  // 3. Signature toggle changes
  useEffect(() => {
    if (!selectedTemplate) return; // Don't overwrite manual text if no template

    applyContentToAll();
  }, [selectedTemplate, selectedAccountId, includeSignature]);

  const applyContentToAll = () => {
    const account = accounts.find((a) => a.id === selectedAccountId);
    const senderName =
      account?.senderName || account?.email?.split("@")[0] || "Me";

    const signatureHtml =
      includeSignature && selectedAccountId
        ? `<br><br>Best Regards,<br><strong>${senderName}</strong>`
        : "";

    const updated = recipients.map((r) => {
      // 1. Get Template Body
      let newBody = selectedTemplate.bodyHtml || r.body;

      // 2. Replace Placeholders
      newBody = replacePlaceholders(newBody, {
        senderName,
        clientName: r.name,
        email: r.email,
        company: "",
      });

      // 3. Append Signature
      newBody = newBody + signatureHtml;

      return {
        ...r,
        subject: selectedTemplate?.subject || r.subject,
        body: newBody,
      };
    });

    setRecipients(updated);
  };

  /* ============================================================
     API HELPERS
  ============================================================ */
  const fetchAccounts = async () => {
    try {
      const res = await api.get(`${API_BASE_URL}/api/accounts`);
      if (res.data.success) setAccounts(res.data.data || []);
    } catch (e) {
      console.error("Error fetching accounts:", e);
    }
  };

  const fetchTemplates = async () => {
    try {
      const res = await api.get(`${API_BASE_URL}/api/email-templates`);
      if (res.data.success) setTemplates(res.data.data || []);
    } catch (e) {
      console.error("Error fetching templates:", e);
    }
  };

  const fetchCustomStatuses = async () => {
    try {
      const res = await api.get(`${API_BASE_URL}/api/customStatus`);
      if (res.data.success) {
        const customNames = res.data.data.map((s) => s.name);
        setAllLeadStatuses((prev) => [...new Set([...prev, ...customNames])]);
      }
    } catch {
      console.log("Using default statuses");
    }
  };

  /* ============================================================
     HANDLERS
  ============================================================ */

  const handleRecipientChange = (index, field, value) => {
    setRecipients((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const handleRemoveRecipient = (index) => {
    setRecipients((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!scheduleDate || !scheduleTime) {
      alert("⚠️ Please select both date and time.");
      return;
    }
    if (recipients.length === 0) {
      alert("⚠️ No valid recipients.");
      return;
    }

    const sendAt = new Date(`${scheduleDate}T${scheduleTime}`);
    if (sendAt < new Date()) {
      alert("⚠️ Scheduled time cannot be in the past.");
      return;
    }

    try {
      setIsSubmitting(true);
      const payload = {
        accountId: selectedAccountId || null,
        sendAt: sendAt.toISOString(),
        messages: recipients.map((r) => ({
          conversationId: r.conversationId,
          toEmail: r.email,
          subject: r.subject || "(No Subject)",
          bodyHtml: r.body || "",
          leadStatus: selectedLeadStatus || "New",
        })),
      };

      const res = await api.post(
        `${API_BASE_URL}/api/scheduled-messages/bulk`,
        payload
      );

      if (res.data.success) {
        alert(`✅ ${res.data.count} follow-up(s) scheduled!`);
        onClose();
      }
    } catch (err) {
      console.error("❌ Bulk schedule error:", err);
      alert(
        "❌ Failed to schedule: " + (err.response?.data?.message || err.message)
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  /* ============================================================
     UI HELPERS
  ============================================================ */
  const getFilteredTemplates = () => {
    if (!selectedLeadStatus) return { recommended: [], others: templates };

    const recommended = templates.filter(
      (t) =>
        t.leadStatus &&
        t.leadStatus.toLowerCase() === selectedLeadStatus.toLowerCase()
    );
    const others = templates.filter(
      (t) =>
        !t.leadStatus ||
        t.leadStatus.toLowerCase() !== selectedLeadStatus.toLowerCase()
    );
    return { recommended, others };
  };

  const { recommended, others } = getFilteredTemplates();

  const activeAccount = accounts.find((a) => a.id === selectedAccountId);

  /* ============================================================
     RENDER
  ============================================================ */
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col animate-in fade-in zoom-in duration-200">
        {/* === Header === */}
        <div className="px-6 py-4 border-b bg-gray-50 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <Clock className="w-5 h-5 text-blue-600" /> Bulk Schedule
            </h2>
            <p className="text-sm text-gray-500">
              Preparing for{" "}
              <span className="font-bold text-gray-900">
                {recipients.length} recipients
              </span>
            </p>
          </div>
          <button
            onClick={() => onClose && onClose()}
            className="p-2 hover:bg-gray-200 rounded-full text-gray-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* === Sidebar (Settings) === */}
          <div className="w-80 bg-white border-r border-gray-200 p-5 flex flex-col gap-6 overflow-y-auto">
            {/* 1. Account */}
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-2">
                From Account
              </label>
              <div className="relative">
                <select
                  value={selectedAccountId || ""}
                  onChange={(e) =>
                    setSelectedAccountId(Number(e.target.value) || null)
                  }
                  className="w-full pl-3 pr-8 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 appearance-none bg-white"
                >
                  <option value="">Decide later (when sending)</option>
                  <option disabled value="">
                    ─────────────────────────
                  </option>
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.email} {acc.senderName ? `(${acc.senderName})` : ""}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-3 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
              {/* 💡 Placeholder Tip */}
              {selectedAccountId && activeAccount?.senderName && (
                <div className="mt-2 text-[10px] text-green-700 bg-green-50 p-2 rounded border border-green-100">
                  {`{sender_name}`} will be replaced with{" "}
                  <strong>{activeAccount.senderName}</strong>
                </div>
              )}
            </div>

            {/* 2. Lead Status */}
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-2 flex items-center gap-2">
                <Tag className="w-3 h-3" /> Lead Status
              </label>
              <div className="relative">
                <select
                  value={selectedLeadStatus}
                  onChange={(e) => {
                    setSelectedLeadStatus(e.target.value);
                    setSelectedTemplate(null);
                  }}
                  className="w-full pl-3 pr-8 py-2.5 border border-indigo-200 rounded-lg text-sm appearance-none bg-indigo-50/30 text-indigo-900 font-medium focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">-- Select Status --</option>
                  {allLeadStatuses.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-3 w-4 h-4 text-indigo-400 pointer-events-none" />
              </div>
            </div>

            {/* 3. Templates */}
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-2">
                Apply Template
              </label>
              <div className="relative">
                <select
                  value={selectedTemplate?.id || ""}
                  onChange={(e) => {
                    const t = templates.find(
                      (temp) => temp.id === Number(e.target.value)
                    );
                    setSelectedTemplate(t);
                  }}
                  className="w-full pl-3 pr-8 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 appearance-none bg-white"
                >
                  <option value="">Select a template...</option>
                  {recommended.length > 0 && (
                    <optgroup
                      label={`⚡ Recommended for "${selectedLeadStatus}"`}
                    >
                      {recommended.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {others.length > 0 && (
                    <optgroup label="Other Templates">
                      {others.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <ChevronDown className="absolute right-3 top-3 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
              {recommended.length > 0 && (
                <p className="text-[10px] text-green-600 mt-1.5 flex items-center gap-1">
                  <Star className="w-3 h-3" /> {recommended.length} recommended
                  templates
                </p>
              )}
            </div>

            {/* 4. Signature Toggle */}
            <div
              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                !selectedAccountId
                  ? "bg-gray-50 border-gray-200 opacity-60"
                  : "bg-blue-50 border-blue-200 hover:bg-blue-100"
              }`}
              onClick={() =>
                selectedAccountId && setIncludeSignature(!includeSignature)
              }
            >
              <div
                className={`w-4 h-4 rounded border flex items-center justify-center ${
                  includeSignature
                    ? "bg-blue-600 border-blue-600"
                    : "bg-white border-gray-300"
                }`}
              >
                {includeSignature && (
                  <CheckCircle2 className="w-3 h-3 text-white" />
                )}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-700">
                  Add "Best Regards"
                </p>
                <p className="text-[10px] text-gray-500">
                  {selectedAccountId
                    ? `As: ${activeAccount?.senderName || "Me"}`
                    : "(Select account first)"}
                </p>
              </div>
            </div>

            {/* 5. Date & Time */}
            <div className="bg-gray-100 p-4 rounded-xl border border-gray-200 mt-auto">
              <label className="block text-xs font-bold text-gray-600 uppercase mb-3">
                Schedule For
              </label>
              <div className="space-y-3">
                <input
                  type="date"
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                  min={new Date().toISOString().split("T")[0]}
                />
                <input
                  type="time"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
              </div>
            </div>
          </div>

          {/* === Recipient List === */}
          <div className="flex-1 bg-gray-50 p-6 overflow-y-auto space-y-4">
            {recipients.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <p>No recipients found. Check selection.</p>
              </div>
            ) : (
              recipients.map((r, i) => (
                <div
                  key={i}
                  className="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="px-4 py-3 border-b border-gray-100 flex justify-between items-center bg-gray-50/50 rounded-t-xl">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-xs border border-indigo-200">
                        {r.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-semibold text-gray-800 text-sm">
                          {r.name}
                        </div>
                        <div className="text-xs text-gray-500">{r.email}</div>
                      </div>
                      <div className="ml-3 px-2.5 py-0.5 rounded-full text-[10px] bg-white border border-gray-200 text-gray-600 font-medium flex items-center gap-1 shadow-sm">
                        <Tag className="w-3 h-3 text-gray-400" />{" "}
                        {selectedLeadStatus || r.currentStatus || "New"}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemoveRecipient(i)}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="p-4 space-y-3">
                    <input
                      className="w-full border-b border-gray-200 px-0 py-1.5 text-sm font-semibold text-gray-800 focus:border-blue-500 focus:outline-none placeholder-gray-400 bg-transparent"
                      placeholder="Subject line..."
                      value={r.subject}
                      onChange={(e) =>
                        handleRecipientChange(i, "subject", e.target.value)
                      }
                    />
                    <textarea
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm h-28 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all resize-y placeholder-gray-400"
                      placeholder="Type message or select a template..."
                      value={r.body
                        .replace(/<br>/g, "\n")
                        .replace(/<[^>]+>/g, "")}
                      onChange={(e) =>
                        handleRecipientChange(i, "body", e.target.value)
                      }
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* === Footer === */}
        <div className="px-6 py-4 border-t bg-white flex justify-end gap-3">
          <button
            onClick={() => onClose && onClose()}
            className="px-5 py-2.5 border rounded-lg text-sm font-medium hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || recipients.length === 0}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium shadow-sm text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting
              ? "Scheduling..."
              : `Schedule ${recipients.length} Message${
                  recipients.length !== 1 ? "s" : ""
                }`}
          </button>
        </div>
      </div>
    </div>
  );
}
