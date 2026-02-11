import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";

import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  Link as LinkIcon,
  Type,
  Minus,
  Eye,
  Save,
} from "lucide-react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

const FONT_FAMILIES = [
  { value: "Calibri, sans-serif", label: "Calibri" },
  { value: "Arial, sans-serif", label: "Arial" },
  { value: "Verdana, sans-serif", label: "Verdana" },
  { value: "Tahoma, sans-serif", label: "Tahoma" },
  { value: "'Trebuchet MS', sans-serif", label: "Trebuchet MS" },
  { value: "'Segoe UI', sans-serif", label: "Segoe UI" },
  { value: "Helvetica, sans-serif", label: "Helvetica" },
  { value: "'Times New Roman', serif", label: "Times New Roman" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: "Garamond, serif", label: "Garamond" },
  { value: "'Palatino Linotype', serif", label: "Palatino" },
  { value: "'Courier New', monospace", label: "Courier New" },
  { value: "Consolas, monospace", label: "Consolas" },
  { value: "Monaco, monospace", label: "Monaco" },
];

// ✅ FIXED: Using px values for better email client compatibility
const FONT_SIZES = [
  { value: "10px", label: "10" },
  { value: "11px", label: "11" },
  { value: "12px", label: "12" },
  { value: "13px", label: "13" },
  { value: "14px", label: "14" },
  { value: "16px", label: "16" },
  { value: "18px", label: "18" },
  { value: "20px", label: "20" },
  { value: "24px", label: "24" },
  { value: "28px", label: "28" },
  { value: "32px", label: "32" },
  { value: "36px", label: "36" },
];

const COLORS = [
  "#000000", "#444444", "#666666", "#999999", "#CCCCCC", "#FFFFFF",
  "#FFCCCC", "#FFCC99", "#FFFF99", "#CCFFCC", "#CCFFFF", "#9999FF", "#FF99FF",
  "#FF0000", "#FF9900", "#0e0e0d", "#00FF00", "#00FFFF",
  "#0000FF", "#9900FF", "#FF00FF",
];

const applyBgColor = (color, editorRef) => {
  if (document.queryCommandSupported("hiliteColor")) {
    document.execCommand("hiliteColor", false, color);
  } else {
    document.execCommand("backColor", false, color);
  }
  editorRef.current?.focus();
};

export default function CreatePitch({ pitch, onSaved }) {
  const editorRef = useRef(null);
  const navigate = useNavigate();

  const [pitchName, setPitchName] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  const [currentFont, setCurrentFont] = useState("Arial, sans-serif");
  const [currentSize, setCurrentSize] = useState("14px");
  const [currentColor, setCurrentColor] = useState("#000000");
  const [showColors, setShowColors] = useState(false);
  const [pitchType, setPitchType] = useState("fresh");
  const [showBgColors, setShowBgColors] = useState(false);

  const format = (cmd, value = null) => {
    document.execCommand(cmd, false, value);
    editorRef.current?.focus();
  };

  // ✅ IMPROVED: Better font size application for email compatibility
  const applyFontSize = (size) => {
    setCurrentSize(size);

    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const selectedContent = range.extractContents();
    
    // Create a span with inline font-size style
    const span = document.createElement('span');
    span.style.fontSize = size;
    span.appendChild(selectedContent);
    
    range.insertNode(span);
    
    // Clean up: merge adjacent spans with same font size
    const editor = editorRef.current;
    if (editor) {
      normalizeSpans(editor);
    }

    editorRef.current?.focus();
  };

  // ✅ NEW: Function to normalize and clean up span elements
  const normalizeSpans = (element) => {
    const spans = element.querySelectorAll('span');
    spans.forEach(span => {
      // Remove empty spans
      if (!span.textContent.trim() && !span.innerHTML.trim()) {
        span.remove();
        return;
      }

      // If span only has font-size and no content attributes, keep it clean
      if (span.style.length === 1 && span.style.fontSize && !span.attributes.length > 1) {
        return;
      }
    });
  };

  // ✅ IMPROVED: Apply font family with better structure
  const applyFontFamily = (fontFamily) => {
    setCurrentFont(fontFamily);
    
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const selectedContent = range.extractContents();
    
    const span = document.createElement('span');
    span.style.fontFamily = fontFamily;
    span.appendChild(selectedContent);
    
    range.insertNode(span);
    
    editorRef.current?.focus();
  };

  useEffect(() => {
    if (pitch) {
      setPitchName(pitch.name || "");
      setPitchType(pitch.type || "fresh");
      setTimeout(() => {
        if (editorRef.current) {
          editorRef.current.innerHTML = pitch.bodyHtml || "";
        }
      }, 0);
    }
  }, [pitch]);

  // ✅ IMPROVED: Ensure content is wrapped properly before saving
  const handleSave = async () => {
    const editor = editorRef.current;
    if (!editor) return;

    // Clean up the HTML
    normalizeSpans(editor);

    let html = editor.innerHTML || "";
    
    // ✅ CRITICAL: Wrap content in a div with base styling if not already wrapped
    if (!html.trim().startsWith('<div') || !html.includes('style=')) {
      html = `<div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #000000;">${html}</div>`;
    }

    const text = html.replace(/<[^>]*>/g, "").toLowerCase();

    const forbidden = [
      "regards",
      "best regards",
      "kind regards",
      "thanks & regards",
      "thanks and regards",
    ];

    const hasSignature = forbidden.some(word => text.includes(word));

    if (hasSignature) {
      alert("Do not add Regards or signature in pitch. Signature will be added automatically.");
      return;
    }

    const token = localStorage.getItem("token");

    const url = pitch
      ? `${API_BASE_URL}/api/pitches/${pitch.id}`
      : `${API_BASE_URL}/api/pitches`;

    const method = pitch ? "PUT" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: pitchName,
          bodyHtml: html,
          type: pitchType,
        }),
      });

      if (!res.ok) {
        alert("Failed to save");
        return;
      }

      alert(pitch ? "Pitch updated" : "Pitch created");

      if (onSaved) {
        onSaved();
      }

      navigate("/pitches", { replace: true });
    } catch (error) {
      console.error(error);
      alert("Server error");
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-50 to-green-50 dark:from-emerald-900/20 dark:to-green-900/20 rounded-2xl p-6 border border-emerald-200 dark:border-emerald-800">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-emerald-600 to-green-600 bg-clip-text text-transparent">
          {pitch ? "Edit Pitch" : "Create Pitch"}
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Design reusable email pitch templates</p>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* LEFT */}
        <div className="col-span-12 space-y-5">
          {/* Pitch Name */}
          <div className="bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-800 rounded-xl p-5 shadow-lg">
            <label className="text-sm font-medium block mb-2 text-slate-700 dark:text-slate-300">Pitch Name</label>
            <input
              value={pitchName}
              onChange={(e) => setPitchName(e.target.value)}
              placeholder="Cold Outreach pitch"
              className="w-full border border-emerald-200 dark:border-emerald-700 bg-white dark:bg-slate-700 text-slate-900 dark:text-white px-4 py-3 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
            />
          </div>

          {/* Pitch Type */}
          <div className="bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-800 rounded-xl p-5 shadow-lg">
            <label className="text-sm font-medium block mb-2 text-slate-700 dark:text-slate-300">Pitch Type</label>
            <select
              value={pitchType}
              onChange={(e) => setPitchType(e.target.value)}
              className="w-full border border-emerald-200 dark:border-emerald-700 bg-white dark:bg-slate-700 text-slate-900 dark:text-white px-4 py-3 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
            >
              <option value="fresh">Fresh Mail (Pitch)</option>
              <option value="followup">Follow Up (Pitch)</option>
            </select>
          </div>

          {/* Editor */}
          <div className="bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-800 rounded-xl overflow-hidden shadow-lg">
            {/* Toolbar */}
            <div className="bg-gradient-to-r from-emerald-50 to-green-50 dark:from-emerald-900/20 dark:to-green-900/20 border-b border-emerald-200 dark:border-emerald-800 p-3 flex flex-wrap gap-2 items-center">
              <select
                value={currentFont}
                onChange={(e) => applyFontFamily(e.target.value)}
                className="border border-emerald-200 dark:border-emerald-700 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-xs px-3 py-2 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
              >
                {FONT_FAMILIES.map(f => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>

              <select
                value={currentSize}
                onChange={(e) => applyFontSize(e.target.value)}
                className="border border-emerald-200 dark:border-emerald-700 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-xs px-3 py-2 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
              >
                {FONT_SIZES.map(s => (
                  <option key={s.value} value={s.value}>{s.label}px</option>
                ))}
              </select>

              <Divider />

              <Btn icon={<Bold size={16} />} onClick={() => format("bold")} />
              <Btn icon={<Italic size={16} />} onClick={() => format("italic")} />
              <Btn icon={<Underline size={16} />} onClick={() => format("underline")} />
              <Btn icon={<Strikethrough size={16} />} onClick={() => format("strikeThrough")} />

              <Divider />

              <Btn icon={<AlignLeft size={16} />} onClick={() => format("justifyLeft")} />
              <Btn icon={<AlignCenter size={16} />} onClick={() => format("justifyCenter")} />
              <Btn icon={<AlignRight size={16} />} onClick={() => format("justifyRight")} />
              <Btn icon={<AlignJustify size={16} />} onClick={() => format("justifyFull")} />

              <Divider />

              <Btn icon={<List size={16} />} onClick={() => format("insertUnorderedList")} />
              <Btn icon={<ListOrdered size={16} />} onClick={() => format("insertOrderedList")} />

              <Divider />

              <Btn icon={<LinkIcon size={16} />} onClick={() => {
                const url = prompt("Enter URL");
                if (url) format("createLink", url);
              }} />

              <Btn icon={<Minus size={16} />} onClick={() => format("insertHorizontalRule")} />

              {/* Text Color */}
              <div className="relative">
                <button 
                  onClick={() => setShowColors(!showColors)} 
                  className="p-2 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded-lg transition-all"
                  title="Text Color"
                >
                  <Type size={18} />
                </button>

                {showColors && (
                  <div className="absolute bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-700 p-3 rounded-xl grid grid-cols-6 gap-2 z-50 shadow-xl">
                    {COLORS.map(c => (
                      <button
                        key={c}
                        style={{ background: c }}
                        className="w-6 h-6 rounded-lg border border-slate-300 dark:border-slate-600 hover:scale-110 transition-transform"
                        onClick={() => {
                          format("foreColor", c);
                          setShowColors(false);
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Background Color */}
              <div className="relative">
                <button
                  onClick={() => setShowBgColors(!showBgColors)}
                  className="p-2 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 rounded-lg transition-all"
                  title="Text Background Color"
                >
                  <span className="text-sm font-bold px-2 py-1 bg-yellow-300 text-slate-900 rounded">A</span>
                </button>

                {showBgColors && (
                  <div className="absolute bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-700 p-3 rounded-xl grid grid-cols-6 gap-2 z-50 shadow-xl">
                    {COLORS.map(c => (
                      <button
                        key={c}
                        style={{ background: c }}
                        className="w-6 h-6 rounded-lg border border-slate-300 dark:border-slate-600 hover:scale-110 transition-transform"
                        onClick={() => {
                          applyBgColor(c, editorRef);
                          setShowBgColors(false);
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Body */}
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              className="min-h-[300px] p-6 outline-none bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              style={{
                fontFamily: "Arial, sans-serif",
                fontSize: "14px",
                lineHeight: "1.6",
              }}
            />

            {/* Footer */}
            <div className="border-t border-emerald-200 dark:border-emerald-800 bg-gradient-to-r from-emerald-50 to-green-50 dark:from-emerald-900/20 dark:to-green-900/20 p-4 gap-3 flex justify-end">
              <button
                onClick={() => setShowPreview(!showPreview)}
                className="flex items-center gap-2 px-5 py-2.5 bg-white dark:bg-slate-700 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-700 text-slate-700 dark:text-slate-300 rounded-lg text-sm font-medium transition-all shadow-md hover:shadow-lg"
              >
                <Eye size={18} />
                {showPreview ? "Hide Preview" : "Show Preview"}
              </button>
              <button
                onClick={handleSave}
                className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white rounded-lg text-sm font-medium transition-all shadow-lg shadow-emerald-500/30 hover:shadow-xl hover:shadow-emerald-500/40"
              >
                <Save size={18} />
                Save Template
              </button>
            </div>
          </div>

          {/* Preview */}
          {showPreview && (
            <div className="bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-800 rounded-xl p-6 shadow-lg">
              <h3 className="text-sm font-semibold mb-4 text-slate-700 dark:text-slate-300 flex items-center gap-2">
                <Eye size={18} className="text-emerald-600 dark:text-emerald-400" />
                Preview
              </h3>
              <div
                className="border border-emerald-200 dark:border-emerald-700 p-6 rounded-lg bg-gradient-to-br from-emerald-50 to-green-50 dark:from-emerald-900/10 dark:to-green-900/10"
                dangerouslySetInnerHTML={{ __html: editorRef.current?.innerHTML || "" }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const Btn = ({ icon, onClick }) => (
  <button 
    onClick={onClick} 
    className="p-2 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 text-slate-700 dark:text-slate-300 rounded-lg transition-all"
  >
    {icon}
  </button>
);

const Divider = () => <div className="w-px h-6 bg-emerald-200 dark:bg-emerald-700 mx-1" />;