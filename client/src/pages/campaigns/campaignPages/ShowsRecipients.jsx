import { useEffect, useState } from "react";
import { Search, Trash2, Save, X, Loader2, UserX } from "lucide-react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export default function ShowsRecipients({ campaignId, onClose, onUpdated }) {
  const [recipients, setRecipients] = useState([]);
  const [filteredRecipients, setFilteredRecipients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [deleteMessage, setDeleteMessage] = useState("");

  // Fetch recipients on mount
  useEffect(() => {
    const fetchRecipients = async () => {
      try {
        const token = localStorage.getItem("token");
        console.log("Fetching recipients for campaign:", campaignId);
        
        const res = await fetch(`${API_BASE_URL}/api/campaigns/${campaignId}/view`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const data = await res.json();

        console.log("Fetched campaign data:", data);

        if (data.success) {
          const fetchedRecipients = data.data.campaign.recipients || [];
          console.log("Recipients loaded:", fetchedRecipients.length);
          setRecipients(fetchedRecipients);
          setFilteredRecipients(fetchedRecipients);
        } else {
          console.error("Failed to load recipients:", data);
        }

        setLoading(false);
      } catch (err) {
        console.error("Failed to load recipients", err);
        setLoading(false);
      }
    };

    if (campaignId) {
      fetchRecipients();
    }
  }, [campaignId]);

  // Handle search filtering
  useEffect(() => {
    if (!searchTerm.trim()) {
      setFilteredRecipients(recipients);
      return;
    }

    const term = searchTerm.toLowerCase();
    const filtered = recipients.filter((r) =>
      r.email.toLowerCase().includes(term)
    );
    setFilteredRecipients(filtered);
  }, [searchTerm, recipients]);

  // Delete single recipient
  const handleDelete = (recipientId) => {
    const recipient = recipients.find((r) => r.id === recipientId);
    
    setRecipients((prev) => prev.filter((r) => r.id !== recipientId));
    setFilteredRecipients((prev) => prev.filter((r) => r.id !== recipientId));
    
    // Show temporary delete message
    setDeleteMessage(`Deleted: ${recipient?.email || "Recipient"}`);
    setTimeout(() => setDeleteMessage(""), 3000);
  };

  // Save remaining recipients
  const handleSave = async () => {
    try {
      setSaving(true);
      const token = localStorage.getItem("token");

      // Ensure campaignId is a number and recipients have all required fields
      const payload = {
        campaignId: Number(campaignId),
        recipients: recipients.map(r => ({
          id: r.id,
          email: r.email,
          status: r.status || "pending",
          accountId: r.accountId,
          sentBodyHtml: r.sentBodyHtml || "",
          sentSubject: r.sentSubject || "",
          sentFromEmail: r.sentFromEmail || ""
        }))
      };

      console.log("Saving recipients payload:", payload);

      const response = await fetch(`${API_BASE_URL}/api/campaigns/followup/update-recipients`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      console.log("Save response:", data);

      if (data.success) {
        onUpdated(); // Refresh parent component
      } else {
        console.error("Save failed:", data);
        alert(`Failed to save recipients: ${data.message || "Please try again."}`);
      }
    } catch (err) {
      console.error("Save error:", err);
      alert("An error occurred while saving recipients. Check console for details.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={backdropStyle}>
      <div style={modalStyle}>
        {/* Header */}
        <div style={headerStyle}>
          <h3 style={titleStyle}>Update Recipients</h3>
          <button onClick={onClose} style={closeButtonStyle}>
            <X size={20} />
          </button>
        </div>

        {/* Search Bar */}
        <div style={searchContainerStyle}>
          <Search size={18} style={{ color: "#10b981", marginRight: "8px" }} />
          <input
            type="text"
            placeholder="Search recipients by email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={searchInputStyle}
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              style={clearSearchStyle}
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Delete Message */}
        {deleteMessage && (
          <div style={deleteMessageStyle}>
            <UserX size={16} />
            <span>{deleteMessage}</span>
          </div>
        )}

        {/* Recipients Count */}
        <div style={countStyle}>
          Showing {filteredRecipients.length} of {recipients.length} recipients
        </div>

        {/* Recipients List */}
        {loading ? (
          <div style={loadingStyle}>
            <Loader2 size={32} style={{ animation: "spin 1s linear infinite" }} />
            <p>Loading recipients...</p>
          </div>
        ) : recipients.length === 0 ? (
          <div style={emptyStyle}>
            <UserX size={48} style={{ color: "#9ca3af" }} />
            <p>No recipients available</p>
          </div>
        ) : filteredRecipients.length === 0 ? (
          <div style={emptyStyle}>
            <Search size={48} style={{ color: "#9ca3af" }} />
            <p>No recipients match your search</p>
          </div>
        ) : (
          <div style={recipientsListStyle}>
            {filteredRecipients.map((r) => (
              <div key={r.id} style={rowStyle}>
                <div style={emailContainerStyle}>
                  <span style={emailStyle}>{r.email}</span>
                  {r.status && (
                    <span style={statusBadgeStyle(r.status)}>
                      {r.status}
                    </span>
                  )}
                </div>

                <button
                  style={deleteBtn}
                  onClick={() => handleDelete(r.id)}
                  title="Remove this recipient"
                >
                  <Trash2 size={16} />
                  <span>Delete</span>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Footer Actions */}
        <div style={footerStyle}>
          <button onClick={onClose} style={cancelBtn}>
            <X size={18} />
            Cancel
          </button>

          <button
            onClick={handleSave}
            style={saveBtn}
            disabled={saving || recipients.length === 0}
          >
            {saving ? (
              <>
                <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} />
                Saving...
              </>
            ) : (
              <>
                <Save size={18} />
                Save Recipients ({recipients.length})
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Styles ---------- */

const backdropStyle = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: "rgba(0, 0, 0, 0.6)",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  zIndex: 9999,
  backdropFilter: "blur(4px)",
};

const modalStyle = {
  background: "#fff",
  padding: "0",
  borderRadius: "12px",
  width: "90%",
  maxWidth: "600px",
  maxHeight: "90vh",
  display: "flex",
  flexDirection: "column",
  boxShadow: "0 20px 60px rgba(0, 0, 0, 0.3)",
};

const headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "20px 24px",
  borderBottom: "2px solid #e5e7eb",
  background: "linear-gradient(to right, #ecfdf5, #d1fae5)",
};

const titleStyle = {
  margin: 0,
  fontSize: "20px",
  fontWeight: "700",
  color: "#059669",
};

const closeButtonStyle = {
  background: "transparent",
  border: "none",
  cursor: "pointer",
  padding: "4px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#6b7280",
  transition: "color 0.2s",
};

const searchContainerStyle = {
  display: "flex",
  alignItems: "center",
  padding: "12px 16px",
  margin: "16px 24px 0",
  border: "2px solid #10b981",
  borderRadius: "8px",
  backgroundColor: "#f0fdf4",
  position: "relative",
};

const searchInputStyle = {
  flex: 1,
  border: "none",
  outline: "none",
  fontSize: "14px",
  backgroundColor: "transparent",
  color: "#111827",
};

const clearSearchStyle = {
  background: "transparent",
  border: "none",
  cursor: "pointer",
  padding: "4px",
  display: "flex",
  alignItems: "center",
  color: "#6b7280",
};

const deleteMessageStyle = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  margin: "12px 24px 0",
  padding: "10px 16px",
  backgroundColor: "#fee2e2",
  color: "#991b1b",
  borderRadius: "6px",
  fontSize: "14px",
  fontWeight: "500",
};

const countStyle = {
  padding: "8px 24px",
  fontSize: "13px",
  color: "#6b7280",
  fontWeight: "500",
};

const recipientsListStyle = {
  flex: 1,
  overflowY: "auto",
  padding: "0 24px",
  marginBottom: "16px",
};

const rowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "14px 16px",
  borderBottom: "1px solid #e5e7eb",
  transition: "background-color 0.2s",
  ":hover": {
    backgroundColor: "#f9fafb",
  },
};

const emailContainerStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  flex: 1,
};

const emailStyle = {
  fontSize: "14px",
  color: "#111827",
  fontWeight: "500",
};

const statusBadgeStyle = (status) => ({
  display: "inline-block",
  padding: "2px 8px",
  fontSize: "11px",
  fontWeight: "600",
  borderRadius: "4px",
  textTransform: "uppercase",
  backgroundColor:
    status === "sent" ? "#dcfce7" : status === "failed" ? "#fee2e2" : "#e0e7ff",
  color:
    status === "sent" ? "#166534" : status === "failed" ? "#991b1b" : "#4338ca",
  width: "fit-content",
});

const deleteBtn = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  background: "#ef4444",
  color: "#fff",
  border: "none",
  padding: "8px 14px",
  borderRadius: "6px",
  cursor: "pointer",
  fontSize: "13px",
  fontWeight: "600",
  transition: "all 0.2s",
  boxShadow: "0 2px 4px rgba(239, 68, 68, 0.2)",
};

const footerStyle = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "12px",
  padding: "16px 24px",
  borderTop: "2px solid #e5e7eb",
  background: "#f9fafb",
};

const cancelBtn = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  background: "#6b7280",
  color: "#fff",
  border: "none",
  padding: "10px 20px",
  borderRadius: "8px",
  cursor: "pointer",
  fontSize: "14px",
  fontWeight: "600",
  transition: "all 0.2s",
};

const saveBtn = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  background: "linear-gradient(to right, #10b981, #059669)",
  color: "#fff",
  border: "none",
  padding: "10px 20px",
  borderRadius: "8px",
  cursor: "pointer",
  fontSize: "14px",
  fontWeight: "600",
  transition: "all 0.2s",
  boxShadow: "0 4px 12px rgba(16, 185, 129, 0.3)",
};

const loadingStyle = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: "60px 20px",
  gap: "16px",
  color: "#6b7280",
};

const emptyStyle = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: "60px 20px",
  gap: "12px",
  color: "#6b7280",
};

// Add keyframes for spin animation
const style = document.createElement("style");
style.innerHTML = `
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
`;
document.head.appendChild(style);