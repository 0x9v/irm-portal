"use client";

import { useState } from "react";
import Link from "next/link";
import { fetchApi, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

export default function MembershipPage() {
  const { user, membership, isLoading: authLoading, refresh } = useAuth();
  
  const [cne, setCne] = useState("");
  const [loading, setLoading] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "error" | "success" | "info" } | null>(null);

  const handleCancelRequest = async () => {
    if (!membership?.id) return;
    setCanceling(true);
    setMessage(null);
    try {
      await fetchApi<void>(`/api/v1/communities/irm/membership/${membership.id}`, {
        method: "DELETE",
      });
      setMessage({ text: "Pending membership request canceled successfully. You may apply again.", type: "success" });
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setMessage({ text: "Unauthorized. Please log in first.", type: "error" });
          await refresh();
        } else if (err.status === 404) {
          setMessage({ text: "Application is no longer available.", type: "error" });
          await refresh();
        } else if (err.status === 409) {
          setMessage({ text: "Application is no longer a pending request.", type: "error" });
          await refresh();
        } else {
          setMessage({ text: "Completion could not be confirmed. Please refresh before retrying.", type: "error" });
        }
      } else {
        setMessage({ text: "A network error occurred. Please refresh before retrying.", type: "error" });
      }
    } finally {
      setCanceling(false);
      setConfirmCancel(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      await fetchApi("/api/v1/communities/irm/membership", {
        method: "POST",
        body: JSON.stringify({ cne }),
      });
      setMessage({ text: "Membership request submitted successfully.", type: "success" });
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setMessage({ text: `Current state: ${err.message}`, type: "info" });
        } else if (err.status === 401) {
          setMessage({ text: "Unauthorized. Please log in first.", type: "error" });
        } else if (err.status === 422) {
          setMessage({ text: `Validation error: ${err.message}`, type: "error" });
        } else {
          setMessage({ text: `Error: ${err.message}`, type: "error" });
        }
      } else if (err instanceof Error) {
        setMessage({ text: err.message, type: "error" });
      } else {
        setMessage({ text: "An unexpected error occurred.", type: "error" });
      }
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) {
    return <div className="p-8 font-sans max-w-2xl mx-auto mt-10">Loading...</div>;
  }

  return (
    <div className="p-8 font-sans max-w-2xl mx-auto mt-10 bg-white border border-gray-200 rounded-lg shadow-sm">
      <h1 className="text-2xl font-bold mb-6">IRM Membership</h1>

      {message && (
        <div 
          className={`mb-6 p-4 rounded border ${
            message.type === "success" ? "bg-green-50 text-green-700 border-green-200" : 
            message.type === "error" ? "bg-red-50 text-red-700 border-red-200" :
            "bg-blue-50 text-blue-700 border-blue-200"
          }`}
        >
          {message.text}
        </div>
      )}

      {!user ? (
        <div className="text-gray-600">
          Please <Link href="/login" className="text-blue-600 hover:underline">log in</Link> to view or request membership.
        </div>
      ) : membership && (membership.status === "ACTIVE" || membership.status === "PENDING") ? (
        <div className="p-4 bg-gray-50 border border-gray-200 rounded">
          <h2 className="font-semibold text-lg mb-2">Current Membership</h2>
          <p>Status: <span className="font-medium text-gray-800">{membership.status}</span></p>
          <p>Role: <span className="font-medium text-gray-800">{membership.role}</span></p>
          {membership.status === "ACTIVE" && membership.role === "DELEGATE" && (
            <div className="mt-4 pt-4 border-t border-gray-200 flex flex-col space-y-2">
              <Link href="/communities/irm/membership/review" className="text-blue-600 hover:underline font-medium">
                Review Pending Applications &rarr;
              </Link>
              <Link href="/communities/irm/membership/staff" className="text-blue-600 hover:underline font-medium">
                Staff Management &rarr;
              </Link>
            </div>
          )}
          
          {membership.status === "PENDING" && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              {!confirmCancel ? (
                <button 
                  onClick={() => setConfirmCancel(true)}
                  disabled={canceling}
                  className="text-red-600 hover:underline font-medium disabled:opacity-50"
                >
                  Cancel pending request
                </button>
              ) : (
                <div className="bg-red-50 p-3 rounded border border-red-100 flex flex-col gap-3">
                  <p className="text-sm text-red-800">
                    Are you sure? Canceling will withdraw this request. You may apply again later.
                  </p>
                  <div className="flex gap-2">
                    <button 
                      onClick={handleCancelRequest}
                      disabled={canceling}
                      className="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded text-sm font-medium disabled:opacity-50"
                    >
                      {canceling ? "Canceling..." : "Confirm Cancellation"}
                    </button>
                    <button 
                      onClick={() => setConfirmCancel(false)}
                      disabled={canceling}
                      className="bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 px-3 py-1.5 rounded text-sm font-medium disabled:opacity-50"
                    >
                      Keep Application
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div>
          {membership?.status === "REJECTED" && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-800 rounded">
              Your previous membership request was REJECTED. You may reapply below.
            </div>
          )}



          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="cne">
                CNE
              </label>
              <input
                id="cne"
                name="cne"
                type="text"
                required
                className="w-full p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={cne}
                onChange={(e) => setCne(e.target.value)}
                placeholder="Enter your CNE"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Submitting..." : (membership?.status === "REJECTED" ? "Reapply for membership" : "Request membership")}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
