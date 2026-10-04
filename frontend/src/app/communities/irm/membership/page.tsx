"use client";

import { useState } from "react";
import Link from "next/link";
import { fetchApi, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { formatFormError, FormErrors } from "@/lib/validation";
import AccessDeniedGuidance from "@/components/AccessDeniedGuidance";

export default function MembershipPage() {
  const { user, membership, isLoading: authLoading, refresh } = useAuth();
  
  const [cne, setCne] = useState("");
  const [loading, setLoading] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "error" | "success" | "info" } | null>(null);
  const [errors, setErrors] = useState<FormErrors>({ fields: {} });

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
    setErrors({ fields: {} });

    try {
      await fetchApi("/api/v1/communities/irm/membership", {
        method: "POST",
        body: JSON.stringify({ cne }),
      });
      setMessage({ text: "Membership request submitted successfully.", type: "success" });
      setCne("");
      await refresh();
    } catch (err) {
      const formatted = formatFormError(err, "Failed to submit membership request.");
      setErrors(formatted);
      if (formatted.general) {
        setMessage({ text: formatted.general, type: "error" });
      }
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) {
    return <div className="p-8 font-sans max-w-2xl mx-auto mt-10 text-gray-500">Loading membership status...</div>;
  }

  if (!user) {
    return (
      <div className="p-4 sm:p-8 font-sans max-w-2xl mx-auto">
        <AccessDeniedGuidance isGuest={true} returnHref="/communities/irm/modules" returnLabel="Modules" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 font-sans max-w-2xl mx-auto mt-6 sm:mt-10">
      {/* Breadcrumb / Navigation */}
      <div className="mb-4 flex flex-wrap justify-between items-center text-sm gap-2">
        <Link href="/communities/irm/modules" className="text-gray-500 hover:text-gray-900 hover:underline">
          &larr; Back to Modules
        </Link>
        <Link href="/" className="text-gray-500 hover:text-gray-900 hover:underline">
          IRM Hub Home
        </Link>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 sm:p-8">
        <h1 className="text-2xl font-bold mb-2 text-gray-900">IRM Membership</h1>
        <p className="text-sm text-gray-500 mb-6">
          Manage your membership in the FST Mohammedia IRM community.
        </p>

        {message && (
          <div 
            role="status"
            className={`mb-6 p-4 rounded-lg border ${
              message.type === "success" ? "bg-green-50 text-green-700 border-green-200" : 
              message.type === "error" ? "bg-red-50 text-red-700 border-red-200" :
              "bg-blue-50 text-blue-700 border-blue-200"
            }`}
          >
            {message.text}
          </div>
        )}

        {membership && (membership.status === "ACTIVE" || membership.status === "PENDING") ? (
          <div className="p-5 bg-gray-50 border border-gray-200 rounded-xl space-y-3">
            <h2 className="font-bold text-lg text-gray-900">Current Membership</h2>
            <div className="space-y-1 text-sm text-gray-700">
              <p>Status: <span className="font-semibold text-gray-900">{membership.status}</span></p>
              <p>Role: <span className="font-semibold text-gray-900">{membership.role}</span></p>
            </div>

            {membership.status === "ACTIVE" && (
              <div className="mt-4 pt-4 border-t border-gray-200 space-y-3">
                <p className="text-xs text-green-800 bg-green-50 border border-green-200 p-2.5 rounded-lg">
                  You are an active member. You can upload resources, preview pending student documents, and vote on community submissions.
                </p>
                <div className="flex flex-wrap gap-3 pt-2">
                  <Link
                    href="/communities/irm/modules"
                    className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors"
                  >
                    Explore Modules &rarr;
                  </Link>
                  <Link
                    href="/communities/irm/documents/pending"
                    className="inline-block bg-white hover:bg-gray-50 text-gray-800 border border-gray-300 font-medium px-4 py-2 rounded-lg text-sm transition-colors"
                  >
                    Pending Documents Review
                  </Link>
                </div>
              </div>
            )}

            {membership.status === "ACTIVE" && membership.role === "DELEGATE" && (
              <div className="mt-4 pt-4 border-t border-gray-200 flex flex-col space-y-2">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Delegate Tools</span>
                <Link href="/communities/irm/membership/review" className="text-blue-600 hover:underline font-medium text-sm">
                  Review Pending Applications &rarr;
                </Link>
                <Link href="/communities/irm/membership/staff" className="text-blue-600 hover:underline font-medium text-sm">
                  Staff Management &rarr;
                </Link>
              </div>
            )}
            
            {membership.status === "PENDING" && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 p-3 rounded-lg mb-3">
                  Your application is awaiting manual verification by the IRM Delegate. You will receive active privileges once verified.
                </p>
                {!confirmCancel ? (
                  <button 
                    type="button"
                    onClick={() => setConfirmCancel(true)}
                    disabled={canceling}
                    className="text-red-600 hover:text-red-800 hover:underline font-medium text-sm disabled:opacity-50"
                  >
                    Cancel pending request
                  </button>
                ) : (
                  <div className="bg-red-50 p-4 rounded-lg border border-red-100 flex flex-col gap-3">
                    <p className="text-sm text-red-800">
                      Are you sure? Canceling will withdraw this request. You may apply again later.
                    </p>
                    <div className="flex gap-2">
                      <button 
                        type="button"
                        onClick={handleCancelRequest}
                        disabled={canceling}
                        className="bg-red-600 hover:bg-red-700 text-white px-3.5 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
                      >
                        {canceling ? "Canceling..." : "Confirm Cancellation"}
                      </button>
                      <button 
                        type="button"
                        onClick={() => setConfirmCancel(false)}
                        disabled={canceling}
                        className="bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 px-3.5 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
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
              <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-800 rounded-lg text-sm">
                Your previous membership request was REJECTED. You may reapply below.
              </div>
            )}

            <p className="text-sm text-gray-600 mb-4">
              Enter your student CNE (Code National de l&apos;Étudiant) to submit your membership request. The IRM Delegate will review and verify your request.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="cne">
                  Student CNE
                </label>
                <input
                  id="cne"
                  name="cne"
                  type="text"
                  required
                  disabled={loading}
                  className={`w-full p-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono transition-colors ${
                    errors.fields.cne ? "border-red-400 bg-red-50/50" : "border-gray-300"
                  }`}
                  value={cne}
                  onChange={(e) => setCne(e.target.value)}
                  placeholder="Enter your CNE"
                />
                {errors.fields.cne && (
                  <p className="text-xs text-red-600 mt-1" role="alert">
                    {errors.fields.cne}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading || !cne.trim()}
                className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-5 rounded-lg shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
              >
                {loading ? "Submitting..." : (membership?.status === "REJECTED" ? "Reapply for membership" : "Request membership")}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
