"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { fetchApi, downloadApiFile, ApiError, API_URL } from "@/lib/api";

type PendingDocument = {
  id: string;
  title: string;
  type: string;
  source: string;
  status: string;
  created_at: string;
  module_id: string;
  module_slug: string;
  module_name: string;
  is_uploader: boolean;
  my_vote: string | null;
  can_vote: boolean;
  full_document_access: boolean;
};

type VoteConfirmation = {
  docId: string;
  title: string;
  access: boolean;
};

export default function PendingDocumentsPage() {
  const [docs, setDocs] = useState<PendingDocument[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<number | null>(null);

  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  
  const previewUrlRef = useRef<string | null>(null);
  const previewAbortController = useRef<AbortController | null>(null);
  
  const [submittingVote, setSubmittingVote] = useState<string | null>(null);
  const [voteError, setVoteError] = useState<{id: string, msg: string} | null>(null);
  
  const [confirmations, setConfirmations] = useState<VoteConfirmation[]>([]);

  // We suppress react-hooks/set-state-in-effect here because the linter statically sees setLoading(true)
  // being invoked, even though we skip it during the initial mount with the isInitial flag.
  const loadDocs = useCallback(async (isInitial = false) => {
    if (!isInitial) setLoading(true);
    setError(null);
    try {
      const data = await fetchApi<PendingDocument[]>("/api/v1/communities/irm/documents/pending");
      setDocs(data);
      setAuthStatus(200);
    } catch (err) {
      if (err instanceof ApiError) {
        setAuthStatus(err.status);
        if (err.status === 401 || err.status === 403) {
          setDocs(null); // Clear docs and voting controls on auth error
          setPreviewUrl(null);
          setPreviewId(null);
        }
        
        if (err.status === 401) {
          setError("Unauthorized. Please log in to view pending documents.");
        } else if (err.status === 403) {
          setError("Active IRM membership is required to view pending documents.");
        } else if (err.status === 404) {
          setError("Community not found.");
        } else {
          setError(`Failed to load pending documents: ${err.message}`);
        }
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An unexpected error occurred.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDocs(true);
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      if (previewAbortController.current) previewAbortController.current.abort();
    };
  }, [loadDocs]);

  const handlePreview = async (docId: string) => {
    if (previewAbortController.current) {
      previewAbortController.current.abort();
    }
    const controller = new AbortController();
    previewAbortController.current = controller;

    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    
    setPreviewId(docId);
    setPreviewUrl(null);
    previewUrlRef.current = null;
    setPreviewLoading(true);
    setPreviewError(null);
    setVoteError(null);

    try {
      const response = await fetch(`${API_URL}/api/v1/documents/${docId}/preview`, { 
        credentials: 'include',
        signal: controller.signal
      });
      
      if (!response.ok) {
        throw new Error(`Failed to load preview: ${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      
      setPreviewUrl(url);
      previewUrlRef.current = url;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      if (err instanceof Error) {
        setPreviewError(err.message);
      } else {
        setPreviewError("Unexpected error loading preview.");
      }
    } finally {
      if (previewAbortController.current === controller) {
        setPreviewLoading(false);
      }
    }
  };

  const handleVote = async (docId: string, voteValue: string) => {
    setSubmittingVote(docId);
    setVoteError(null);
    try {
      const data = await fetchApi<{ vote: string; full_document_access: boolean }>(
        `/api/v1/documents/${docId}/vote`,
        {
          method: "POST",
          body: JSON.stringify({ vote: voteValue }),
        }
      );
      
      const docTitle = docs?.find(d => d.id === docId)?.title || "Document";
      
      setConfirmations(prev => {
        // Remove existing confirmation for this doc if it somehow exists
        const filtered = prev.filter(c => c.docId !== docId);
        return [...filtered, { docId, title: docTitle, access: data.full_document_access }];
      });

      await loadDocs(false);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setVoteError({ id: docId, msg: "Voting is no longer available or you have already voted." });
          await loadDocs(false);
        } else if (err.status === 401 || err.status === 403) {
          await loadDocs(false);
        } else {
          setVoteError({ id: docId, msg: err.message });
        }
      } else if (err instanceof Error) {
        setVoteError({ id: docId, msg: err.message });
      }
    } finally {
      setSubmittingVote(null);
    }
  };

  const handleDownload = async (docId: string, title: string) => {
    try {
      await downloadApiFile(`/api/v1/documents/${docId}/download`, title);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        alert("This document is no longer accessible.");
        await loadDocs(false);
      } else {
        alert("Download failed.");
      }
    }
  };

  return (
    <main className="p-8 font-sans max-w-4xl mx-auto mt-10">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Pending Documents</h1>
        <div className="flex gap-4">
          <Link href="/communities/irm/modules" className="text-blue-600 hover:underline text-sm">
            Back to Modules
          </Link>
          <button onClick={() => loadDocs(false)} className="text-blue-600 hover:underline text-sm">
            Refresh
          </button>
        </div>
      </div>

      {confirmations.length > 0 && (
        <div className="mb-6 space-y-3">
          {confirmations.map(conf => (
            <div key={conf.docId} className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-center justify-between">
              <div>
                <p className="text-green-800 font-medium">Vote successfully recorded for &quot;{conf.title}&quot;.</p>
                {!conf.access && <p className="text-sm text-green-700">The document is no longer in the pending queue.</p>}
              </div>
              {conf.access && (
                <button
                  onClick={() => handleDownload(conf.docId, conf.title)}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded font-medium text-sm"
                >
                  Download Original
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {loading && !docs ? (
        <div className="text-gray-600">Loading pending documents...</div>
      ) : error ? (
        <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded flex flex-col gap-2 items-start">
          <span>{error}</span>
          {authStatus === 401 && (
            <Link href="/login" className="text-blue-700 underline font-medium mt-2">
              Go to Login
            </Link>
          )}
          <button onClick={() => loadDocs(false)} className="mt-2 bg-red-100 hover:bg-red-200 text-red-800 px-3 py-1 rounded text-sm">Retry</button>
        </div>
      ) : docs?.length === 0 ? (
        <div className="text-gray-600">No pending documents to review.</div>
      ) : (
        <div className="space-y-6">
          {docs?.map((doc) => (
            <div key={doc.id} className="p-5 border border-gray-200 rounded-lg shadow-sm bg-white">
              <h2 className="text-xl font-semibold mb-2">{doc.title}</h2>
              <div className="grid grid-cols-2 gap-2 text-sm text-gray-700 mb-4">
                <p><span className="font-medium">Module:</span> {doc.module_name}</p>
                <p><span className="font-medium">Type:</span> {doc.type}</p>
                <p><span className="font-medium">Status:</span> {doc.status}</p>
                <p><span className="font-medium">Date:</span> {new Date(doc.created_at).toLocaleDateString()}</p>
              </div>

              {doc.is_uploader && (
                <div className="mb-4 inline-block bg-blue-50 text-blue-800 px-3 py-1 rounded text-sm font-medium border border-blue-200">
                  Your upload - Voting disabled
                </div>
              )}

              {doc.my_vote && (
                <div className="mb-4 inline-block bg-gray-50 text-gray-800 px-3 py-1 rounded text-sm font-medium border border-gray-200">
                  You voted: {doc.my_vote}
                </div>
              )}

              <div className="flex flex-wrap gap-3 items-center">
                <button
                  onClick={() => handlePreview(doc.id)}
                  className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-4 py-2 rounded font-medium text-sm border border-gray-300"
                >
                  {previewId === doc.id && previewLoading ? "Loading preview..." : "Load Preview"}
                </button>
                
                {doc.full_document_access && (
                  <button
                    onClick={() => handleDownload(doc.id, doc.title)}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded font-medium text-sm"
                  >
                    Download Original
                  </button>
                )}
              </div>

              {previewId === doc.id && (
                <div className="mt-4 border-t pt-4">
                  <h3 className="text-lg font-medium mb-2">First Page Preview</h3>
                  {previewLoading && <div className="text-gray-500 text-sm">Loading protected preview...</div>}
                  {previewError && (
                    <div className="text-red-600 text-sm">
                      {previewError} <button onClick={() => handlePreview(doc.id)} className="underline ml-2">Retry</button>
                    </div>
                  )}
                  {previewUrl && !previewLoading && (
                    <div className="mb-4">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={previewUrl} alt={`Preview of ${doc.title}`} className="max-w-full h-auto border rounded shadow-sm" />
                      <p className="text-xs text-gray-500 mt-2 italic">This is only the first-page preview.</p>
                    </div>
                  )}

                  {previewUrl && !previewLoading && doc.can_vote && !doc.is_uploader && (
                    <div className="bg-gray-50 p-4 rounded border mt-4">
                      <p className="font-medium text-gray-900 mb-2">Is this document relevant to this module&apos;s studies?</p>
                      <p className="text-xs text-gray-600 mb-4 space-y-1">
                        &bull; One vote per document. The vote cannot be changed.<br/>
                        &bull; YES may unlock the full document while it is pending.<br/>
                        &bull; Community votes determine final acceptance.
                      </p>
                      
                      {voteError?.id === doc.id && (
                        <div className="text-red-600 text-sm mb-3 bg-red-50 p-2 rounded">{voteError.msg}</div>
                      )}
                      
                      <div className="flex gap-3">
                        <button
                          onClick={() => handleVote(doc.id, "YES")}
                          disabled={submittingVote === doc.id}
                          className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded font-medium disabled:opacity-50"
                        >
                          {submittingVote === doc.id ? "Submitting..." : "YES — relevant"}
                        </button>
                        <button
                          onClick={() => handleVote(doc.id, "NO")}
                          disabled={submittingVote === doc.id}
                          className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded font-medium disabled:opacity-50"
                        >
                          {submittingVote === doc.id ? "Submitting..." : "NO — not relevant"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
