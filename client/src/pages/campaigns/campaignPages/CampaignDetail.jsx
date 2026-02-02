import React, { useEffect, useState } from "react";
import { Send, Plus, Trash2, Eye } from "lucide-react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

// ------------------------------
// Local lightweight UI components
// (no shadcn / @ alias needed)
// ------------------------------
const Card = ({ children, className = "" }) => (
  <div className={`bg-white border border-gray-200 rounded-2xl shadow-sm ${className}`}>{children}</div>
);

const CardHeader = ({ children }) => (
  <div className="px-5 py-4 border-b border-gray-100">{children}</div>
);

const CardTitle = ({ children, className = "" }) => (
  <h2 className={`text-lg font-semibold text-gray-900 ${className}`}>{children}</h2>
);

const CardContent = ({ children, className = "" }) => (
  <div className={`p-5 ${className}`}>{children}</div>
);

const Button = ({ children, className = "", variant = "default", size = "md", ...props }) => {
  const base = "inline-flex items-center justify-center gap-1.5 font-medium rounded-xl transition focus:outline-none";
  const variants = {
    default: "bg-black text-white hover:bg-gray-800",
    outline: "border border-gray-300 text-gray-700 hover:bg-gray-50",
    ghost: "text-gray-600 hover:bg-gray-100",
  };
  const sizes = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-sm",
    icon: "p-2",
  };

  return (
    <button {...props} className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}>
      {children}
    </button>
  );
};

export default function CampaignDetail() {
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [loadedCampaign, setLoadedCampaign] = useState(null);

  const [subjects, setSubjects] = useState([]);
  const [followUpBody, setFollowUpBody] = useState("");
  const [originalBody, setOriginalBody] = useState("");
  const [preview, setPreview] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [pitches, setPitches] = useState([]);
  const [selectedPitchId, setSelectedPitchId] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [sendingFollowup, setSendingFollowup] = useState(false);
  const [modal, setModal] = useState({ open: false, type: "", message: "" });

  // ------------------------------
  // Fetch campaigns
  // ------------------------------
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/campaigns`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem("token")}`,
      },
    })
      .then((res) => res.json())
      .then((data) => {
        console.log("Campaign API:", data);
        const filtered = (data.data || []).filter(c => {
          const completedTime = new Date(c.createdAt).getTime();
          const now = Date.now();
          const hours24 = 24 * 60 * 60 * 1000;

          return (
            (c.sendType === "immediate" || c.sendType === "scheduled") &&
            c.status === "completed" &&
            !c.parentCampaignId &&
            now - completedTime >= hours24
          );
        });


        setCampaigns(filtered);

      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/accounts`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem("token")}`,
      },
    })
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setAccounts(data);
        } else if (Array.isArray(data.data)) {
          setAccounts(data.data);
        } else {
          setAccounts([]);
        }
      })
      .catch(console.error);
  }, []);

useEffect(() => {
  const fetchPitches = async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_BASE_URL}/api/pitches`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();

      if (data.success) {
        const followupPitches = (data.data || []).filter(
          p => p.type === "followup"
        );
        setPitches(followupPitches);
      }
    } catch (err) {
      console.error("Failed to load pitches", err);
    }
  };

  fetchPitches();
}, []);

  const getFromEmails = () => {
    if (!loadedCampaign || !Array.isArray(accounts)) return [];

    let ids = [];
    try {
      ids = JSON.parse(loadedCampaign.fromAccountIds || "[]");
    } catch {}

    return accounts
      .filter(acc => ids.includes(acc.id))
      .map(acc => acc.email);
  };

const buildFollowupWithSignature = () => {
  return followUpBody || "";
};

const handleSelectCampaign = (id) => {
  setSelectedCampaignId(id);
  const campaign = campaigns.find((c) => String(c.id) === String(id));

  if (!campaign) return;

  setLoadedCampaign(campaign);

  try {
    const parsedSubjects = JSON.parse(campaign.subject || "[]");
    setSubjects(parsedSubjects.length ? parsedSubjects : [campaign.subject]);
  } catch {
    setSubjects([campaign.subject]);
  }

  // ✅ FIXED HERE
  const firstRecipient = campaign.recipients?.find(r => r.sentBodyHtml);

  setOriginalBody(
    firstRecipient?.sentBodyHtml ||
    campaign.bodyHtml ||
    ""
  );
};

const createFollowUp = async () => {
  if (!loadedCampaign) {
    setModal({ open: true, type: "error", message: "Please select a campaign first." });
    return;
  }

  try {
    setSendingFollowup(true);

    const senderRecipientMap = {};

    let fromAccountIds = [];
    try {
      fromAccountIds = JSON.parse(loadedCampaign.fromAccountIds || "[]");
    } catch {}

    if (!fromAccountIds.length) {
      throw new Error("No sender accounts found in base campaign");
    }

    (loadedCampaign.recipients || []).forEach((r, index) => {
      const accountId =
        r.accountId || fromAccountIds[index % fromAccountIds.length];

      if (!senderRecipientMap[accountId]) {
        senderRecipientMap[accountId] = [];
      }

      senderRecipientMap[accountId].push(r.email);
    });

    const res = await fetch(`${API_BASE_URL}/api/campaigns/followup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("token")}`,
      },
      body: JSON.stringify({
        baseCampaignId: loadedCampaign.id,
        subjects,
        bodyHtml: buildFollowupWithSignature(),
        senderRecipientMap,
      }),
    });

    const data = await res.json();

    if (!data.success) {
      throw new Error(data.message || "Follow-up failed");
    }

    // ✅ SUCCESS MODAL
    setModal({
      open: true,
      type: "success",
      message: "Follow-up campaign started successfully. Emails are now sending.",
    });

  } catch (err) {
    setModal({
      open: true,
      type: "error",
      message: err.message || "Something went wrong",
    });
  } finally {
    setSendingFollowup(false);
  }
};

  const froms = getFromEmails();
// Save email body
  const saveEmailBody = async () => {
  if (!loadedCampaign) return alert("Select campaign first");

  try {
    setSaving(true);
    setSaveMsg("");

    const res = await fetch(
      `${API_BASE_URL}/api/campaigns/${loadedCampaign.id}/followup-body`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          bodyHtml: followUpBody,
        }),
      }
    );

    const data = await res.json();

    if (!data.success) throw new Error(data.message);

    setSaveMsg("Email body saved successfully ✅");
  } catch (err) {
    setSaveMsg("Failed to save ❌");
  } finally {
    setSaving(false);
  }
};


  return (
    <div className="grid grid-cols-12 gap-6 p-6 bg-white">
      {/* Left */}
      <div className="col-span-8 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Follow-up Campaign</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Campaign selector */}
            <div>
              <label className="text-sm font-medium">Select Campaign</label>
              <select
                className="w-full mt-2 border rounded-xl px-3 py-2"
                value={selectedCampaignId}
                onChange={(e) => handleSelectCampaign(e.target.value)}
              >
                <option value="">Choose campaign...</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Email header preview */}
            {loadedCampaign && (
              <div className="bg-gray-50 border rounded-xl p-4 text-xs space-y-1">
                
                {/* From */}
                <div><b>From:</b> {getFromEmails()[0] || "—"}</div>
                <p className="text-xs text-gray-400">
                  Rotates between {getFromEmails().length} accounts
                </p>

                {/* Sent */}
                <div><b>Sent:</b> {new Date(loadedCampaign.createdAt).toLocaleString()}</div>

                {/* To */}
                <div><b>To:</b> {loadedCampaign.recipients?.[0]?.email || "—"}</div>
                <p className="text-xs text-gray-400">
                  Will send to total {loadedCampaign.recipients?.length || 0} recipients (distributed automatically)
                </p>

                {/* Subject */}
                <div><b>Subject:</b> {subjects[0]}</div>
                <p className="text-xs text-gray-400">
                  Rotates between {subjects.length} subject lines
                </p>
              </div>
            )}


            {/* Subjects */}
              {/* Subjects (Read-only from original campaign) */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Subject Lines (from original campaign)</h3>

              {subjects.map((sub, i) => (
                <div
                  key={i}
                  className="border rounded-xl px-3 py-2 text-sm bg-gray-50 text-gray-700"
                >
                  {sub}
                </div>
              ))}
            </div>


            {/* Pitch selector */}
            <div>
              <label className="text-sm font-medium">Select Pitch</label>
              <select
                className="w-full mt-2 border rounded-xl px-3 py-2"
                value={selectedPitchId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedPitchId(id);

                  const pitch = pitches.find(p => String(p.id) === id);
                  if (!pitch) return;

                  setFollowUpBody(pitch.bodyHtml || "");
                }}
              >

                <option value="">Manual / Custom</option>
                {pitches.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>


            {/* Body */}
            <div>
              <label className="text-sm font-medium">Email Body</label>

              <div
                className="w-full mt-2 border rounded-xl px-4 py-3 text-sm min-h-[200px] bg-white"
                contentEditable
                suppressContentEditableWarning
                onInput={(e) => setFollowUpBody(e.currentTarget.innerHTML)}
                dangerouslySetInnerHTML={{ __html: followUpBody }}
              />

            </div>


            {/* Actions */}
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setPreview(!preview)}>
                <Eye className="w-4 h-4 mr-1" /> Preview
              </Button>
              <Button onClick={createFollowUp} disabled={sendingFollowup}>
                {sendingFollowup ? (
                  <>
                    <span className="animate-pulse">Sending...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-1" /> Create Follow-up
                  </>
                )}
              </Button>


            </div>
          </CardContent>
        </Card>

        {/* Preview panel */}
        {preview && loadedCampaign && (
          <Card>
            <CardHeader>
              <CardTitle>Email Preview</CardTitle>
            </CardHeader>

            <CardContent className="space-y-6 text-base text-black">

              {/* 1. FOLLOW-UP (top) */}
              <div className="border rounded-xl p-4 bg-white">
                <div className="font-semibold text-gray-700 mb-2">Follow-up</div>
                <div dangerouslySetInnerHTML={{ __html: buildFollowupWithSignature() }} />
              </div>

              {/* 2. THREAD HEADER (like Gmail) */}
              <div className="border-t pt-4 text-sm space-y-1 bg-white p-3 rounded-lg">
                <div><b>From:</b> {froms[0] || "—"}</div>
                <div className="text-xs text-gray-500">
                  Sending will rotate between:
                  <ul className="list-disc ml-5">
                    {froms.map(f => <li key={f}>{f}</li>)}
                  </ul>
                </div>
                <div><b>Sent:</b> {new Date(loadedCampaign.createdAt).toLocaleString()}</div>
                <div><b>To:</b> {loadedCampaign.recipients?.[0]?.email || "—"}</div>
                <div className="text-xs text-gray-500">
                  Will send to total {loadedCampaign.recipients?.length || 0} recipients (distributed automatically)
                </div>
                 
                <div><b>Subject:</b> {subjects[0]}</div>
              </div>


              {/* 3. ORIGINAL CAMPAIGN (bottom) */}
              <div className="border rounded-xl p-4 bg-white text-base text-black">
                <div className="font-semibold mb-2">Previous message</div>
                <div dangerouslySetInnerHTML={{ __html: originalBody }} />
              </div>


            </CardContent>
          </Card>
        )}

        
      </div>

      {/* Right summary */}
      <div className="col-span-4">
        <Card className="sticky top-6">
          <CardHeader>
            <CardTitle className="text-base">Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {/* Campaign Name */}
            <div>
              <p className="text-gray-500">Campaign</p>
              <p className="font-medium">
                {loadedCampaign?.name || "Not selected"}
              </p>
            </div>

            {/* From Mail Accounts Count */}
            <div>
              <p className="text-gray-500">From Mail Accounts</p>
              <p className="font-medium">
                {getFromEmails().length}
              </p>
            </div>

            {/* Subjects Count */}
            <div>
              <p className="text-gray-500">Subjects</p>
              <p className="font-medium">
                {subjects.length}
              </p>
            </div>

            {/* Recipients Count */}
            <div>
              <p className="text-gray-500">Recipients</p>
              <p className="font-medium">
                {loadedCampaign?.recipients?.length || 0}
              </p>
            </div>
          </CardContent>

        </Card>
      </div>

      {modal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl space-y-4">
            
            <h2 className={`text-lg font-bold ${
              modal.type === "success" ? "text-green-600" : "text-red-600"
            }`}>
              {modal.type === "success" ? "Success" : "Error"}
            </h2>

            <p className="text-sm text-gray-700">
              {modal.message}
            </p>

            <div className="flex justify-end">
              <button
                onClick={() => setModal({ open: false, type: "", message: "" })}
                className="px-4 py-2 rounded-xl bg-black text-white text-sm"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

    </div>

    
  );
}
