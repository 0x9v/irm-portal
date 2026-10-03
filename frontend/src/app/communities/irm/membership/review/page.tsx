"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { fetchApi, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

type PendingMembership = {
  id: string;
  status: string;
  role: string;
  cne: string;
  created_at: string;
  updated_at: string;
  username: string;
  first_name: string;
  family_name: string;
};

export default function MembershipReviewPage() {
  const { user, membership, isLoading: authLoading, refresh } = useAuth();
  
  const [queue, setQueue] = useState<PendingMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ text: string; safeToRetry: boolean } | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchApi("/api/v1/communities/irm/membership/pending");
      setQueue(data as PendingMembership[]);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setError({ text: "Authentication expired. Please log in again.", safeToRetry: false });
          refresh();
        } else if (err.status === 403) {
          setError({ text: "Authorization denied. You must be an ACTIVE DELEGATE.", safeToRetry: false });
          refresh();
        } else if (err.status === 404) {
          setError({ text: "Community not found or unavailable.", safeToRetry: false });
        } else {
          setError({ text: "Could not fetch pending applications. Please try again.", safeToRetry: true });
        }
      } else {
        setError({ text: "A network error occurred.", safeToRetry: true });
      }
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  useEffect(() => {
    // Only fetch if definitely authorized locally to avoid redundant 403s
    if (membership && membership.status === "ACTIVE" && membership.role === "DELEGATE") {
      fetchQueue();
    }
  }, [membership, fetchQueue]);

  // Clear data on unmount or auth loss
  useEffect(() => {
    if (!user || (membership && (membership.status !== "ACTIVE" || membership.role !== "DELEGATE"))) {
      setQueue([]);
      setConfirmation(null);
      setError(null);
    }
  }, [user, membership]);

  if (authLoading) {
    return <div className="p-8 font-sans max-w-4xl mx-auto mt-10">Loading context...</div>;
  }

  if (!user) {
    return (
      <div className="p-8 font-sans max-w-4xl mx-auto mt-10 bg-white border border-gray-200 rounded-lg shadow-sm">
        <h1 className="text-2xl font-bold mb-6">Membership Review</h1>
        <div className="text-gray-600">
          Please <Link href="/login" className="text-blue-600 hover:underline">log in</Link>.
        </div>
      </div>
    );
  }

  if (!membership || membership.status !== "ACTIVE" || membership.role !== "DELEGATE") {
    return (
      <div className="p-8 font-sans max-w-4xl mx-auto mt-10 bg-white border border-gray-200 rounded-lg shadow-sm">
        <h1 className="text-2xl font-bold mb-6 text-red-600">Access Denied</h1>
        <p className="text-gray-700">Only ACTIVE DELEGATE members can review applications.</p>
        <Link href="/communities/irm/membership" className="mt-4 inline-block text-blue-600 hover:underline">
          &larr; Back to Membership
        </Link>
      </div>
    );
  }

  const handleReview = async (id: string, action: "approve" | "reject") => {
    setProcessingId(id);
    setConfirmation(null);

    try {
      const resp = await fetchApi(`/api/v1/communities/irm/membership/${id}/${action}`, {
        method: "POST"
      });
      
      const newStatus = (resp as Record<string, unknown>).status as string;
      const newRole = (resp as Record<string, unknown>).role as string;
      
      setConfirmation({ 
        text: `Application was successfully ${action}d. Resulting status: ${newStatus}, role: ${newRole}.`, 
        type: "success" 
      });
      
      // Successfully processed, refresh the queue
      fetchQueue();
      
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setConfirmation({ text: "Application could not be reviewed in its current state (it may already have been processed).", type: "info" });
      fetchQueue();
        } else if (err.status === 401 || err.status === 403) {
          setConfirmation({ text: "Authorization changed during review. Please refresh.", type: "error" });
          refresh();
        } else {
          setConfirmation({ text: "Completion could not be confirmed. Please refresh before retrying.", type: "error" });
        }
      } else {
        setConfirmation({ text: "A network error occurred. Please refresh before retrying.", type: "error" });
      }
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="p-8 font-sans max-w-4xl mx-auto mt-10 bg-white border border-gray-200 rounded-lg shadow-sm">
      <div className="mb-6">
        <Link href="/communities/irm/membership" className="text-blue-600 hover:underline text-sm mb-2 inline-block">
          &larr; Back to Membership
        </Link>
        <h1 className="text-2xl font-bold">Review Applications</h1>
        <p className="text-sm text-gray-500 mt-1">
          Review pending applicant CNEs carefully.
          <br/>
          <strong>Approval activates membership. Rejection allows the applicant to reapply.</strong>
        </p>
      </div>

      {confirmation && (
        <div className={`mb-6 p-4 rounded border ${
          confirmation.type === 'success' ? 'bg-green-50 border-green-200 text-green-800' :
          confirmation.type === 'info' ? 'bg-blue-50 border-blue-200 text-blue-800' :
          'bg-red-50 border-red-200 text-red-800'
        }`}>
          {confirmation.text}
        </div>
      )}

      {error ? (
        <div className="p-4 bg-red-50 border border-red-200 text-red-800 rounded">
          <p>{error.text}</p>
          {error.safeToRetry && (
            <button 
              onClick={fetchQueue}
              className="mt-2 bg-white text-red-600 px-3 py-1 border border-red-300 rounded hover:bg-red-50 text-sm font-medium"
            >
              Retry
            </button>
          )}
        </div>
      ) : loading && queue.length === 0 ? (
        <div className="text-gray-500 py-4">Loading queue...</div>
      ) : queue.length === 0 ? (
        <div className="text-gray-500 py-8 text-center border-2 border-dashed border-gray-200 rounded-lg">
          No pending applications at this time.
          <br/>
          <button onClick={fetchQueue} className="mt-4 text-blue-600 hover:underline text-sm">
            Refresh Queue
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex justify-end mb-2">
            <button 
              onClick={fetchQueue} 
              disabled={!!processingId || loading}
              className="text-sm text-blue-600 hover:underline disabled:opacity-50"
            >
              {loading ? "Refreshing..." : "Refresh Queue"}
            </button>
          </div>
          {queue.map(app => (
            <div key={app.id} className="p-4 border border-gray-200 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <p className="font-semibold text-lg">{app.first_name || ""} {app.family_name || ""} <span className="text-gray-500 text-base font-normal">(@{app.username})</span></p>
                <div className="mt-1 text-sm text-gray-700 space-y-1">
                  <p>CNE: <span className="font-medium font-mono bg-gray-100 px-1 rounded">{app.cne}</span></p>
                  <p>Status: <span className="font-medium text-amber-600">{app.status}</span></p>
                  <p className="text-xs text-gray-500">
                    Applied: {new Date(app.created_at).toLocaleString()}
                    {app.updated_at !== app.created_at && ` (Last updated: ${new Date(app.updated_at).toLocaleString()})`}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 shrink-0 mt-2 md:mt-0">
                <button
                  onClick={() => handleReview(app.id, "approve")}
                  disabled={!!processingId}
                  className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {processingId === app.id ? "Processing..." : "Approve"}
                </button>
                <button
                  onClick={() => handleReview(app.id, "reject")}
                  disabled={!!processingId}
                  className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {processingId === app.id ? "Processing..." : "Reject"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
