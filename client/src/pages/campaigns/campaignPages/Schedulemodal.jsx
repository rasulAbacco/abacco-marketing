import React, { useEffect, useState, useMemo, useRef } from "react";
import { X, Loader2, Users, CheckCircle, Clock, AlertCircle, Copy, Check } from "lucide-react";
import { api } from "../../utils/api";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

// ✅ PERF FIX: Virtual list renders only ~20 visible rows instead of ALL rows.
// With 1000+ recipients this makes the modal open near-instantly.
const ROW_HEIGHT = 40;
const VISIBLE_ROWS = 20;

function VirtualEmailTable({ allEmails, processingEmails, completedEmails, failedEmails }) {
  const maxRows = Math.max(allEmails.length, processingEmails.length, completedEmails.length, failedEmails.length);
  const containerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);

  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 2);
  const endIndex = Math.min(maxRows, startIndex + VISIBLE_ROWS + 4);
  const visibleRows = Array.from({ length: endIndex - startIndex }, (_, i) => startIndex + i);

  return (
    <div
      ref={containerRef}
      className="border border-gray-300 rounded-lg overflow-auto bg-white"
      style={{ maxHeight: `${ROW_HEIGHT * VISIBLE_ROWS}px` }}
      onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
    >
      {/* Fixed headers */}
      <div className="grid grid-cols-3 sticky top-0 z-10">
        <div className="bg-gray-100 border-b border-r border-gray-300 px-4 py-3 font-bold text-sm text-gray-700">Total Recipients {allEmails.length}</div>
        <div className="bg-gray-100 border-b border-r border-gray-300 px-4 py-3 font-bold text-sm text-gray-700">Processing {processingEmails.length}</div>
        <div className="bg-gray-100 border-b border-r border-gray-300 px-4 py-3 font-bold text-sm text-gray-700">Completed {completedEmails.length}</div>
        {/* <div className="bg-red-50 border-b border-gray-300 px-4 py-3 font-bold text-sm text-red-700">Failed {failedEmails.length}</div> */}
      </div>

      {/* Virtual scroll body */}
      <div style={{ height: `${maxRows * ROW_HEIGHT}px`, position: "relative" }}>
        <div style={{ position: "absolute", top: `${startIndex * ROW_HEIGHT}px`, width: "100%" }}>
          {visibleRows.map(rowIndex => (
            <div key={rowIndex} className="grid grid-cols-3" style={{ height: ROW_HEIGHT }}>
              <div className="border-b border-r border-gray-200 px-4 py-2.5 text-sm text-gray-700 truncate">{allEmails[rowIndex] || ''}</div>
              <div className="border-b border-r border-gray-200 px-4 py-2.5 text-sm text-gray-700 truncate">{processingEmails[rowIndex] || ''}</div>
              <div className="border-b border-r border-gray-200 px-4 py-2.5 text-sm text-gray-700 truncate">{completedEmails[rowIndex] || ''}</div>
              {/* <div className="border-b border-gray-200 px-4 py-2.5 text-sm text-red-600 truncate">{failedEmails[rowIndex] || ''}</div> */}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function CampaignView({ campaignId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copiedSection, setCopiedSection] = useState(null);

  useEffect(() => {
    if (campaignId) {
      fetchCampaign();
    }
  }, [campaignId]);

  const fetchCampaign = async () => {
    try {
      setLoading(true);
      setError(null);
      
      console.log("Fetching campaign:", campaignId);
      const res = await api.get(
        `${API_BASE_URL}/api/campaigns/${campaignId}/view`
      );
      
      console.log("API Response:", res.data);
      
      if (res.data.success) {
        setData(res.data.data);
      } else {
        setError("Failed to load campaign data");
      }
    } catch (error) {
      console.error("Failed to fetch campaign:", error);
      setError(error.response?.data?.message || "Failed to load campaign");
    } finally {
      setLoading(false);
    }
  };

  // Handle click on backdrop to close
  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Copy emails to clipboard
  const copyEmails = async (emails, section) => {
    try {
      const emailList = emails.join('\n');
      await navigator.clipboard.writeText(emailList);
      setCopiedSection(section);
      setTimeout(() => setCopiedSection(null), 2000);
    } catch (err) {
      console.error('Failed to copy emails:', err);
    }
  };

  // Get recipients by status
  const getRecipientsByStatus = (status) => {
    if (!data?.campaign?.recipients) return [];
    return data.campaign.recipients.filter(r => {
      if (status === 'completed') return r.status === 'sent' || r.status === 'completed';
      if (status === 'processing') return r.status === 'pending' || r.status === 'processing';
      if (status === 'failed') return r.status === 'failed' || r.status === 'error';
      return false;
    });
  };

  if (!campaignId) return null;

  // Calculate email groups
  const allEmails = data ? data.campaign.recipients.map(r => r.email) : [];
  const processingEmails = data ? getRecipientsByStatus('processing').map(r => r.email) : [];
  const completedEmails = data ? getRecipientsByStatus('completed').map(r => r.email) : [];
  const failedEmails = data ? getRecipientsByStatus('failed').map(r => r.email) : [];
  
  const isCampaignComplete = data && data.stats.processing === 0 && data.stats.completed === data.stats.total;

  // Determine the maximum number of rows needed
  const maxRows = Math.max(allEmails.length, processingEmails.length, completedEmails.length, failedEmails.length);

  return (
    <div 
      className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-[9999] p-4"
      onClick={handleBackdropClick}
    >
      <div className="bg-white w-full max-w-5xl mt-20 max-h-[90vh] overflow-hidden rounded-2xl shadow-2xl relative animate-fadeIn mx-auto">
        
        {loading ? (
          // Loading State
          <div className="flex flex-col items-center justify-center p-16">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-500 to-green-600 rounded-full blur-xl opacity-30"></div>
              <Loader2 className="relative animate-spin text-emerald-600 mb-4" size={48} />
            </div>
            <p className="text-gray-600 font-medium mt-4">Loading campaign details...</p>
          </div>
        ) : error ? (
          // Error State
          <div className="p-16 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-red-100 rounded-full mb-4">
              <AlertCircle className="text-red-600" size={32} />
            </div>
            <p className="text-red-600 text-lg font-semibold mb-6">{error}</p>
            <button
              onClick={fetchCampaign}
              className="px-6 py-3 bg-gradient-to-r from-emerald-600 to-green-600 text-white rounded-xl hover:from-emerald-700 hover:to-green-700 font-semibold shadow-lg shadow-emerald-500/30 transition-all transform hover:scale-105"
            >
              Retry
            </button>
          </div>
        ) : data ? (
          // Content State
          <>
            {/* Header with Close Button */}
            <div className="sticky top-0 bg-gradient-to-r from-emerald-50 via-teal-50 to-green-50 border-b border-emerald-200/50 px-8 py-6 flex items-start justify-between">
              <div className="flex-1 pr-8">
                <h2 className="text-2xl font-bold text-gray-900 mb-2">
                  {data.campaign.name}
                </h2>
                <p className="text-sm text-gray-600">Campaign Recipients & Statistics</p>
              </div>
              
              <button
                onClick={onClose}
                className="flex-shrink-0 text-gray-400 hover:text-gray-600 hover:bg-white/50 rounded-full p-2 transition-all"
              >
                <X size={24} />
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="overflow-y-auto max-h-[calc(90vh-140px)] p-8">
              
              {/* Stats Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                {/* Total Recipients */}
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-5 border border-blue-200/50 shadow-sm">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-blue-100 rounded-lg">
                      <Users className="text-blue-600" size={20} />
                    </div>
                    <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Total</span>
                  </div>
                  <p className="text-3xl font-black text-blue-900">{data.stats.total}</p>
                  <p className="text-xs text-blue-600 mt-1">Recipients</p>
                </div>

                {/* Processing */}
                <div className="bg-gradient-to-br from-yellow-50 to-orange-50 rounded-xl p-5 border border-yellow-200/50 shadow-sm">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-yellow-100 rounded-lg">
                      <Clock className="text-yellow-600" size={20} />
                    </div>
                    <span className="text-xs font-semibold text-yellow-700 uppercase tracking-wide">Processing</span>
                  </div>
                  <p className="text-3xl font-black text-yellow-900">{data.stats.processing}</p>
                  <p className="text-xs text-yellow-600 mt-1">In Queue</p>
                </div>

                {/* Completed */}
                <div className="bg-gradient-to-br from-emerald-50 to-green-50 rounded-xl p-5 border border-emerald-200/50 shadow-sm">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-emerald-100 rounded-lg">
                      <CheckCircle className="text-emerald-600" size={20} />
                    </div>
                    <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Completed</span>
                  </div>
                  <p className="text-3xl font-black text-emerald-900">{data.stats.completed}</p>
                  <p className="text-xs text-emerald-600 mt-1">Sent Successfully</p>
                </div>

                {/* Failed (if any) */}
                {data.stats.failed > 0 && (
                  <div className="bg-gradient-to-br from-red-50 to-pink-50 rounded-xl p-5 border border-red-200/50 shadow-sm">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="p-2 bg-red-100 rounded-lg">
                        <AlertCircle className="text-red-600" size={20} />
                      </div>
                      <span className="text-xs font-semibold text-red-700 uppercase tracking-wide">Failed</span>
                    </div>
                    <p className="text-3xl font-black text-red-900">{data.stats.failed}</p>
                    <p className="text-xs text-red-600 mt-1">Errors</p>
                  </div>
                )}
              </div>

              {/* Summary Text */}
              <div className="mb-6 p-4 bg-gradient-to-r from-gray-50 to-slate-50 rounded-xl border border-gray-200">
                <p className="text-sm text-gray-700 font-medium">
                  Total Recipients <span className="font-bold text-blue-600">{data.stats.total}</span>, 
                  Processing count <span className="font-bold text-yellow-600">{data.stats.processing}</span>, 
                  Completed - <span className="font-bold text-emerald-600">{data.stats.completed}</span>
                  {data.stats.failed > 0 && (
                    <>, Failed - <span className="font-bold text-red-600">{data.stats.failed}</span></>
                  )}
                </p>
              </div>

              {/* Recipients Section - Show by Status in Table Format */}
              <div className="space-y-6">
                
                {/* All Recipients in One Table with Columns */}
                {data.campaign.recipients && data.campaign.recipients.length > 0 ? (
                  <div>
                    {/* Header with Total Count and Copy Button */}
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-4">
                        <h3 className="text-base font-bold text-gray-900">
                          Total Recipients {data.stats.total}
                        </h3>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        {/* Copy All */}
                        <button
                          onClick={() => copyEmails(allEmails, 'all')}
                          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm font-medium shadow-sm"
                          title="Copy all emails"
                        >
                          {copiedSection === 'all' ? (
                            <>
                              <Check size={16} />
                              <span>Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy size={16} />
                              <span>Copy All</span>
                              <span className="bg-blue-800 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                                {allEmails.length}
                              </span>
                            </>
                          )}
                        </button>

                        {/* Copy Processing */}
                        <button
                          onClick={() => copyEmails(processingEmails, 'processing')}
                          className="flex items-center gap-2 px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg transition-colors text-sm font-medium shadow-sm"
                          title="Copy processing emails"
                        >
                          {copiedSection === 'processing' ? (
                            <>
                              <Check size={16} />
                              <span>Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy size={16} />
                              <span>Copy Processing</span>
                              <span className="bg-yellow-700 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                                {processingEmails.length}
                              </span>
                            </>
                          )}
                        </button>

                        {/* Copy Completed */}
                        <button
                          onClick={() => copyEmails(completedEmails, 'completed')}
                          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors text-sm font-medium shadow-sm"
                          title="Copy completed emails"
                        >
                          {copiedSection === 'completed' ? (
                            <>
                              <Check size={16} />
                              <span>Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy size={16} />
                              <span>Copy Completed</span>
                              <span className="bg-emerald-800 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                                {completedEmails.length}
                              </span>
                            </>
                          )}
                        </button>

                        {/* Copy Failed - always show */}
                        <button
                          onClick={() => copyEmails(failedEmails, 'failed')}
                          className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors text-sm font-medium shadow-sm"
                          title="Copy failed emails"
                        >
                          {copiedSection === 'failed' ? (
                            <>
                              <Check size={16} />
                              <span>Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy size={16} />
                              <span>Copy Failed</span>
                              <span className="bg-red-800 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                                {failedEmails.length}
                              </span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Table Layout - Virtualized for performance with large lists */}
                    <VirtualEmailTable
                      allEmails={allEmails}
                      processingEmails={processingEmails}
                      completedEmails={completedEmails}
                      failedEmails={failedEmails}
                    />

                    {/* Status Legend */}
                    <div className="flex items-center gap-6 mt-4 px-4">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                        <span className="text-xs font-medium text-gray-600">Total: {allEmails.length}</span>
                      </div>
                      {processingEmails.length > 0 && (
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                          <span className="text-xs font-medium text-gray-600">Processing: {processingEmails.length}</span>
                        </div>
                      )}
                      {completedEmails.length > 0 && (
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                          <span className="text-xs font-medium text-gray-600">Completed: {completedEmails.length}</span>
                        </div>
                      )}
                      {failedEmails.length > 0 && (
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-red-500"></div>
                          <span className="text-xs font-medium text-gray-600">Failed: {failedEmails.length}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12 bg-gray-50 rounded-xl border-2 border-dashed border-gray-300">
                    <Users className="mx-auto text-gray-400 mb-3" size={48} />
                    <p className="text-gray-500 font-medium">No recipients found</p>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}