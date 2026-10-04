

"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { fetchApi, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

type ActiveMembership = {
  id: string;
  status: string;
  role: string;
  created_at: string;
  updated_at: string;
  username: string;
  first_name: string;
  family_name: string;
};

type Permissions = {
  upload_official_documents: boolean;
  create_announcements: boolean;
  manage_document_voting: boolean;
};

export default function StaffManagementPage() {
  const { user, membership, isLoading: authLoading, refresh } = useAuth();
  
  const [roster, setRoster] = useState<ActiveMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ text: string; safeToRetry: boolean } | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);

  // Editor State
  const [editingModId, setEditingModId] = useState<string | null>(null);
  const [modPermissions, setModPermissions] = useState<Permissions | null>(null);
  const [savingPerms, setSavingPerms] = useState(false);

  const fetchRoster = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchApi("/api/v1/communities/irm/membership/active");
      setRoster(data as ActiveMembership[]);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setError({ text: "Authentication expired. Please log in again.", safeToRetry: false });
          refresh();
        } else if (err.status === 403) {
          setError({ text: "Access denied. Only ACTIVE Delegates can manage staff.", safeToRetry: false });
        } else {
          setError({ text: `Failed to load roster: ${err.message}`, safeToRetry: true });
        }
      } else {
        setError({ text: "Network error loading roster.", safeToRetry: true });
      }
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  useEffect(() => {
    if (authLoading) return;
    
    if (!user) return;
    if (!membership || membership.status !== "ACTIVE" || membership.role !== "DELEGATE") return;
    
    setTimeout(() => {
        fetchRoster();
    }, 0);
  }, [user, membership, authLoading, fetchRoster]);

  const handleRoleTransition = async (targetId: string, targetRole: "MEMBER" | "MODERATOR", confirmMessage: string) => {
    if (!window.confirm(confirmMessage)) return;
    
    setProcessingId(targetId);
    setConfirmation(null);
    try {
      await fetchApi(`/api/v1/communities/irm/membership/${targetId}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role: targetRole }),
      });
      
      setConfirmation({ text: `Role successfully updated to ${targetRole}.`, type: "success" });
      if (editingModId === targetId) {
        setEditingModId(null);
        setModPermissions(null);
      }
      await fetchRoster();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401 || err.status === 403) {
          setConfirmation({ text: "Authorization lost. Please reload.", type: "error" });
          refresh();
        } else if (err.status === 409) {
          setConfirmation({ text: "Target's role or status changed. Refreshing roster.", type: "error" });
          await fetchRoster();
        } else if (err.status === 404) {
          setConfirmation({ text: "Target unavailable. Refreshing roster.", type: "error" });
          await fetchRoster();
        } else {
          setConfirmation({ text: `Failed: ${err.message}. Completion could not be confirmed.`, type: "error" });
        }
      } else {
        setConfirmation({ text: "Network error. Completion could not be confirmed.", type: "error" });
      }
    } finally {
      setProcessingId(null);
    }
  };

  const handleEditPermissions = async (targetId: string) => {
    setEditingModId(targetId);
    setModPermissions(null);
    setConfirmation(null);
    try {
      const data = await fetchApi(`/api/v1/communities/irm/membership/${targetId}/permissions`);
      // Since it's async, make sure we're still editing this target
      if (editingModId === targetId || !editingModId) {
          setModPermissions(data as Permissions);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
          setConfirmation({ text: "Target is no longer an active moderator. Refreshing roster.", type: "error" });
          setEditingModId(null);
          await fetchRoster();
      } else {
          setConfirmation({ text: "Failed to load permissions.", type: "error" });
      }
    }
  };
  
  // Protect against stale response when changing selections rapidly
  useEffect(() => {
      let isSubscribed = true;
      if (editingModId) {
          fetchApi(`/api/v1/communities/irm/membership/${editingModId}/permissions`)
            .then(data => {
                if (isSubscribed) setModPermissions(data as Permissions);
            })
            .catch(err => {
                if (!isSubscribed) return;
                if (err instanceof ApiError && err.status === 409) {
                    setConfirmation({ text: "Target is no longer an active moderator. Refreshing roster.", type: "error" });
                    setEditingModId(null);
                    fetchRoster();
                } else {
                    setConfirmation({ text: "Failed to load permissions.", type: "error" });
                }
            });
      }
      return () => { isSubscribed = false; };
  }, [editingModId, fetchRoster]);

  const handleSavePermissions = async () => {
    if (!editingModId || !modPermissions) return;
    
    setSavingPerms(true);
    setConfirmation(null);
    try {
      const data = await fetchApi(`/api/v1/communities/irm/membership/${editingModId}/permissions`, {
        method: "PATCH",
        body: JSON.stringify(modPermissions),
      });
      setModPermissions(data as Permissions);
      setConfirmation({ text: "Permissions saved successfully.", type: "success" });
    } catch (err) {
      if (err instanceof ApiError) {
         if (err.status === 409) {
             setConfirmation({ text: "Target is no longer an active moderator. Refreshing roster.", type: "error" });
             setEditingModId(null);
             await fetchRoster();
         } else if (err.status === 401 || err.status === 403) {
             setConfirmation({ text: "Authorization lost. Please reload.", type: "error" });
             refresh();
         } else {
             setConfirmation({ text: `Failed to save: ${err.message}`, type: "error" });
         }
      } else {
          setConfirmation({ text: "Network error saving permissions.", type: "error" });
      }
    } finally {
      setSavingPerms(false);
    }
  };

  if (authLoading || (loading && !error && user && membership?.status === "ACTIVE" && membership?.role === "DELEGATE")) {
    return (
      <div className="p-8 max-w-4xl mx-auto mt-10 text-center text-gray-500">
        Loading staff management...
      </div>
    );
  }

  if (error || !user || !membership || membership.status !== "ACTIVE" || membership.role !== "DELEGATE") {
    const errorText = error ? error.text : (!user ? "Please log in." : "Access denied. Only ACTIVE Delegates can manage staff.");
    return (
      <div className="p-8 max-w-4xl mx-auto mt-10 bg-white border border-red-200 rounded-lg shadow-sm">
        <h2 className="text-xl font-bold text-red-600 mb-2">Access Error</h2>
        <p className="text-gray-700">{errorText}</p>
        {error?.safeToRetry && (
          <button 
            onClick={fetchRoster}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
          >
            Try Again
          </button>
        )}
        {!user && (
          <div className="mt-4">
            <Link href="/login" className="text-blue-600 hover:underline">Go to Login</Link>
          </div>
        )}
        {user && (
            <div className="mt-4">
              <Link href="/communities/irm/membership" className="text-blue-600 hover:underline text-sm inline-block">
                &larr; Back to Membership
              </Link>
            </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-8 font-sans max-w-4xl mx-auto mt-10 bg-white border border-gray-200 rounded-lg shadow-sm">
      <div className="mb-6">
        <div className="flex flex-wrap justify-between items-center gap-2 mb-2 text-sm">
          <div className="flex gap-4 items-center">
            <Link href="/communities/irm/membership" className="text-blue-600 hover:underline">
              &larr; Back to Membership
            </Link>
            <Link href="/communities/irm/modules" className="text-gray-500 hover:text-gray-800 hover:underline">
              Explore Modules
            </Link>
          </div>
          <Link href="/communities/irm/membership/review" className="text-gray-500 hover:text-gray-800 hover:underline">
            Review Applications &rarr;
          </Link>
        </div>
        <h1 className="text-2xl font-bold">Staff Management</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage roles and permissions for ACTIVE members.
          <br/>
          <strong>New Moderators start without extra permissions. Returning to Member revokes Moderator grants.</strong>
        </p>
      </div>

      {confirmation && (
        <div className={`mb-6 p-4 rounded-md ${
          confirmation.type === 'success' ? 'bg-green-50 border border-green-200 text-green-800' : 
          confirmation.type === 'error' ? 'bg-red-50 border border-red-200 text-red-800' : 
          'bg-blue-50 border border-blue-200 text-blue-800'
        }`}>
          {confirmation.text}
        </div>
      )}

      {roster.length === 0 ? (
        <p className="text-gray-500 italic">No active members found.</p>
      ) : (
        <div className="space-y-4">
          {roster.map((member) => (
            <div key={member.id} className="p-4 border rounded-md flex flex-col md:flex-row md:justify-between md:items-center bg-gray-50">
              <div>
                <p className="font-semibold text-lg">{member.first_name || ''} {member.family_name || ''} <span className="text-gray-500 font-normal text-sm">(@{member.username})</span></p>
                <div className="flex space-x-2 mt-1">
                  <span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-800 font-medium">
                    {member.role}
                  </span>
                  <span className="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-800 font-medium">
                    {member.status}
                  </span>
                </div>
              </div>
              <div className="mt-4 md:mt-0 flex gap-2 flex-wrap">
                {member.role === "MEMBER" && (
                  <button
                    onClick={() => handleRoleTransition(member.id, "MODERATOR", "Are you sure you want to promote this member to Moderator? They will start with no special permissions until you configure them.")}
                    disabled={processingId === member.id}
                    className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    {processingId === member.id ? "Processing..." : "Make Moderator"}
                  </button>
                )}
                {member.role === "MODERATOR" && (
                  <>
                    <button
                      onClick={() => handleEditPermissions(member.id)}
                      disabled={processingId === member.id}
                      className="px-3 py-1.5 bg-gray-600 text-white text-sm font-medium rounded hover:bg-gray-700 disabled:opacity-50"
                    >
                      Manage permissions
                    </button>
                    <button
                      onClick={() => handleRoleTransition(member.id, "MEMBER", "Are you sure you want to demote this Moderator to an ordinary Member? All their Moderator permissions will be immediately revoked.")}
                      disabled={processingId === member.id}
                      className="px-3 py-1.5 bg-red-600 text-white text-sm font-medium rounded hover:bg-red-700 disabled:opacity-50"
                    >
                      {processingId === member.id ? "Processing..." : "Return to Member"}
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editingModId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold mb-4">Edit Moderator Permissions</h3>
            {modPermissions ? (
              <div className="space-y-4">
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={modPermissions.upload_official_documents}
                    onChange={(e) => setModPermissions({...modPermissions, upload_official_documents: e.target.checked})}
                    className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-gray-800">Publish official documents</span>
                </label>
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={modPermissions.create_announcements}
                    onChange={(e) => setModPermissions({...modPermissions, create_announcements: e.target.checked})}
                    className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-gray-800">Create announcements</span>
                </label>
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={modPermissions.manage_document_voting}
                    onChange={(e) => setModPermissions({...modPermissions, manage_document_voting: e.target.checked})}
                    className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-gray-800">Manage voting settings</span>
                </label>
                
                <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
                  <button
                    onClick={() => setEditingModId(null)}
                    disabled={savingPerms}
                    className="px-4 py-2 text-gray-700 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSavePermissions}
                    disabled={savingPerms}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    {savingPerms ? "Saving..." : "Save Permissions"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="py-8 text-center text-gray-500">
                Loading permissions...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
