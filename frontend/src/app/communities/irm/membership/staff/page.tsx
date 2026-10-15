"use client";

import { PendingLabel } from "@/components/ui/Button";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { fetchApi, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import PageContainer from "@/components/PageContainer";
import Breadcrumbs from "@/components/Breadcrumbs";
import ModerationAction from "@/components/moderation/ModerationAction";
import { isConfirmedDelegate, RemovalLedger } from "@/lib/moderation";
import { useAsyncScope } from "@/lib/useAsyncScope";
import FeedbackMessage from "@/components/FeedbackMessage";
import { ContentEmpty } from "@/components/ContentState";

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
  const auth = useAuth();
  if (!isConfirmedDelegate(auth)) return <PageContainer width="wide">
    {auth.isLoading || auth.isRefreshing ? <p role="status">Checking Delegate access…</p>
      : <FeedbackMessage type="error" message={auth.membershipError || auth.error ? "Delegate access could not be verified. Please try again." : "Only confirmed ACTIVE Delegates can manage members and staff."} onRetry={auth.refresh} retryLabel="Verify access" />}
    <Link href="/account#community-membership" className="inline-flex min-h-[44px] items-center text-accent">Back to Community membership</Link>
  </PageContainer>;
  return <AuthorizedStaffManagement key={`${auth.user!.id}:${auth.membership!.id}`} />;
}

function AuthorizedStaffManagement() {
  const { user, membership, isLoading: authLoading, refresh } = useAuth();

  const [roster, setRoster] = useState<ActiveMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ text: string; safeToRetry: boolean } | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ text: string; type: "success" | "error" | "info" | "warning" } | null>(null);
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);

  // Editor State
  const [editingModId, setEditingModId] = useState<string | null>(null);
  const [modPermissions, setModPermissions] = useState<Permissions | null>(null);
  const [savingPerms, setSavingPerms] = useState(false);

  const captureScope = useAsyncScope(`${user?.id}:${membership?.id}`);
  const [removed] = useState(() => new RemovalLedger());
  const rosterRequest = useRef(0);
  const removalRevision = useRef(0);
  // A confirmed removal must also filter a roster read begun before that removal.
  const reconcileMember = (id: string, banned: boolean, unavailable: boolean) => {
    removed.remove(id);
    removalRevision.current++;
    setRoster(prev => prev.filter(member => member.id !== id));
    if (editingModId === id) { setEditingModId(null); setModPermissions(null); }
    setConfirmation({ type: "info", text: unavailable ? "This membership is unavailable; the row has been cleared. Refresh the roster to check its current state."
      : banned ? "Member banned from IRM. Their account and contributions remain; access and reapplication are blocked."
      : "Membership ended. Their account and contributions remain; they may apply again." });
  };

  const fetchRoster = useCallback(async () => {
    const isCurrent = captureScope();
    const requestId = ++rosterRequest.current;
    const revision = removalRevision.current;
    setLoading(true);
    setError(null);
    setRefreshWarning(null);
    try {
      const data = await fetchApi("/api/v1/communities/irm/membership/active");
      if (!isCurrent() || requestId !== rosterRequest.current) return;
      setRoster(revision === removalRevision.current ? data as ActiveMembership[] : removed.filter(data as ActiveMembership[]));
    } catch (err) {
      if (!isCurrent()) return;
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setError({ text: "Authentication expired. Please log in again.", safeToRetry: false });
          refresh();
        } else if (err.status === 403) {
          setError({ text: "Access denied. Only ACTIVE Delegates can manage staff.", safeToRetry: false });
          void refresh();
        } else {
          setError({ text: "Member roster could not be loaded. Please try again.", safeToRetry: true });
        }
      } else {
        setError({ text: "Network error loading roster.", safeToRetry: true });
      }
    } finally {
      if (isCurrent() && requestId === rosterRequest.current) setLoading(false);
    }
  }, [refresh, captureScope, removed]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) return;
    if (!membership || membership.status !== "ACTIVE" || membership.role !== "DELEGATE") return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchRoster();
  }, [user, membership, authLoading, fetchRoster]);

  const handleRoleTransition = async (targetId: string, targetRole: "MEMBER" | "MODERATOR", confirmMessage: string) => {
    const isCurrent = captureScope();
    if (!window.confirm(confirmMessage)) return;

    setProcessingId(targetId);
    setConfirmation(null);
    setRefreshWarning(null);

    try {
      await fetchApi(`/api/v1/communities/irm/membership/${targetId}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role: targetRole }),
      });

      if (!isCurrent()) return;
      setConfirmation({ text: `Role successfully updated to ${targetRole}.`, type: "success" });
      if (editingModId === targetId) {
        setEditingModId(null);
        setModPermissions(null);
      }

      try {
        const revision = removalRevision.current;
        const refreshedData = await fetchApi("/api/v1/communities/irm/membership/active");
        if (!isCurrent()) return;
        setRoster(revision === removalRevision.current ? refreshedData as ActiveMembership[] : removed.filter(refreshedData as ActiveMembership[]));
      } catch {
        if (!isCurrent()) return;
        setRefreshWarning("Role updated. The roster could not refresh; retry loading the roster.");
      }
    } catch (err) {
      if (!isCurrent()) return;
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
          setConfirmation({ text: "The role change could not be confirmed. Refresh the roster before trying again.", type: "warning" });
        }
      } else {
        setConfirmation({ text: "The role change could not be confirmed. Refresh the roster before trying again.", type: "warning" });
      }
    } finally {
      if (isCurrent()) setProcessingId(null);
    }
  };

  const handleEditPermissions = async (targetId: string) => {
    const isCurrent = captureScope();
    setEditingModId(targetId);
    setModPermissions(null);
    setConfirmation(null);
    try {
      const data = await fetchApi(`/api/v1/communities/irm/membership/${targetId}/permissions`);
      if (!isCurrent()) return;
      if (editingModId === targetId || !editingModId) {
        setModPermissions(data as Permissions);
      }
    } catch (err) {
      if (!isCurrent()) return;
      if (err instanceof ApiError && err.status === 409) {
        setConfirmation({ text: "Target is no longer an active moderator. Refreshing roster.", type: "error" });
        setEditingModId(null);
        await fetchRoster();
      } else {
        setConfirmation({ text: "Failed to load permissions.", type: "error" });
      }
    }
  };

  const handleSavePermissions = async () => {
    const isCurrent = captureScope();
    if (!editingModId || !modPermissions) return;

    setSavingPerms(true);
    setConfirmation(null);
    setRefreshWarning(null);

    try {
      const data = await fetchApi(`/api/v1/communities/irm/membership/${editingModId}/permissions`, {
        method: "PATCH",
        body: JSON.stringify(modPermissions),
      });
      if (!isCurrent()) return;
      setModPermissions(data as Permissions);
      setConfirmation({ text: "Permissions saved successfully.", type: "success" });
    } catch (err) {
      if (!isCurrent()) return;
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setConfirmation({ text: "Target is no longer an active moderator. Refreshing roster.", type: "error" });
          setEditingModId(null);
          await fetchRoster();
        } else if (err.status === 401 || err.status === 403) {
          setConfirmation({ text: "Authorization lost. Please reload.", type: "error" });
          refresh();
        } else {
          setConfirmation({ text: "The permission update could not be confirmed. Refresh permissions before trying again.", type: "warning" });
        }
      } else {
        setConfirmation({ text: "The permission update could not be confirmed. Refresh permissions before trying again.", type: "warning" });
      }
    } finally {
      if (isCurrent()) setSavingPerms(false);
    }
  };

  if (authLoading || (loading && !error && user && membership?.status === "ACTIVE" && membership?.role === "DELEGATE")) {
    return (
      <PageContainer width="wide">
        <div className="py-12 text-center text-text-muted text-sm">Loading staff management...</div>
      </PageContainer>
    );
  }

  if (error || !user || !membership || membership.status !== "ACTIVE" || membership.role !== "DELEGATE") {
    const errorText = error ? error.text : (!user ? "Please log in." : "Access denied. Only ACTIVE Delegates can manage staff.");
    return (
      <PageContainer width="wide">
        <div className="p-6 sm:p-8 bg-surface border border-error-border rounded-surface shadow-none space-y-4">
          <h2 className="text-xl font-bold text-error">Access Error</h2>
          <p className="text-text-muted text-sm">{errorText}</p>
          <div className="flex flex-wrap gap-3 items-center pt-2">
            {error?.safeToRetry && (
              <button
                onClick={fetchRoster}
                className="ui-button ui-button--primary"
              >
                Try Again
              </button>
            )}
            {!user ? (
              <Link href="/login" className="ui-button ui-button--secondary">
                Go to Login
              </Link>
            ) : (
              <Link href="/account#community-membership" className="ui-button ui-button--secondary">
                &larr; Back to Community membership
              </Link>
            )}
          </div>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer width="wide">
      {/* Breadcrumb Navigation */}
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Membership", href: "/account#community-membership" },
          { label: "Manage Staff" },
        ]}
      />

      <div className="mb-6 flex flex-wrap justify-between items-center gap-4">
        <div className="flex flex-wrap gap-4 items-center text-sm">
          <Link
            href="/account#community-membership"
            className="ui-button ui-button--secondary"
          >
            &larr; Back to Community membership
          </Link>
          <Link
            href="/communities/irm/modules"
            className="ui-button ui-button--secondary"
          >
            Explore Modules
          </Link>
        </div>
        <Link
          href="/communities/irm/membership/review"
          className="ui-button ui-button--secondary"
        >
          Review Applications &rarr;
        </Link>
      </div>

      <div className="bg-surface border border-border rounded-surface shadow-none p-6 sm:p-8 space-y-6">
        <div>
          <p className="ui-eyebrow">IRM / Membership</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-text tracking-tight">Staff Management</h1>
          <p className="text-sm text-text-muted mt-1 leading-relaxed">
            Manage roles and permissions for ACTIVE community members.
            <br />
            <strong>New Moderators start without extra permissions. Returning to Member revokes Moderator grants.</strong>
          </p>
        </div>

        <div className="rounded-control border border-border bg-surface-secondary p-4 space-y-2">
          <h2 className="text-lg font-semibold text-text">Community member management</h2>
          <p className="text-sm text-text-muted">Showing ACTIVE members from the authorized community roster. Remove ends membership; Ban also blocks reapplication. Accounts and contributions remain.</p>
          <Link href="/communities/irm/membership/members" className="ui-button ui-button--secondary">Open Members for all statuses and Unban →</Link>
          <button type="button" onClick={fetchRoster} disabled={loading} aria-busy={loading} className="ui-button ui-button--secondary">Refresh member roster</button>
        </div>

        {confirmation && (
          <FeedbackMessage type={confirmation.type} message={confirmation.text} />
        )}

        {refreshWarning && (
          <FeedbackMessage
            type="warning"
            message={refreshWarning}
            onRetry={fetchRoster}
            retryLabel="Retry loading roster"
          />
        )}

        {roster.length === 0 ? (
          <ContentEmpty title="No active members found." description="The active community roster is empty." />
        ) : (
          <div className="space-y-4">
            {roster.map((member) => (
              <div
                key={member.id}
                className="p-4 sm:p-5 border border-border rounded-surface flex flex-col md:flex-row md:justify-between md:items-center gap-4 bg-surface-secondary"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-base sm:text-lg text-text break-words">
                    {member.first_name || ""} {member.family_name || ""}{" "}
                    <span className="text-text-muted font-normal text-sm">(@{member.username})</span>
                  </p>
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    <span className="px-2.5 py-0.5 text-xs rounded-full bg-accent-soft text-accent font-semibold">
                      {member.role}
                    </span>
                    <span className="px-2.5 py-0.5 text-xs rounded-full bg-success-surface text-success font-semibold">
                      {member.status}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-2 md:pt-0">
                  {member.status === "ACTIVE" && (member.role === "MEMBER" || member.role === "MODERATOR") && member.id !== membership?.id && <>
                    <ModerationAction kind="member" id={member.id} context={`@${member.username}`} disabled={processingId === member.id || savingPerms || !!editingModId}
                      onRemoved={unavailable => reconcileMember(member.id, false, unavailable)} onCheck={fetchRoster} />
                    <ModerationAction kind="ban" id={member.id} context={`@${member.username}`} disabled={processingId === member.id || savingPerms || !!editingModId}
                      onRemoved={unavailable => reconcileMember(member.id, true, unavailable)} onCheck={fetchRoster} />
                  </>}
                  {member.role === "MEMBER" && (
                    <button
                      onClick={() =>
                        handleRoleTransition(
                          member.id,
                          "MODERATOR",
                          "Are you sure you want to promote this member to Moderator? They will start with no special permissions until you configure them."
                        )
                      }
                      disabled={processingId === member.id} aria-busy={processingId === member.id}
                      className="ui-button ui-button--secondary w-full sm:w-auto"
                    >
                      <PendingLabel pending={!!(processingId === member.id)} idle="Make Moderator" busy="Processing..." />
                    </button>
                  )}
                  {member.role === "MODERATOR" && (
                    <>
                      <button
                        onClick={() => handleEditPermissions(member.id)}
                        disabled={processingId === member.id} aria-busy={processingId === member.id}
                        className="ui-button ui-button--secondary w-full sm:w-auto"
                      >
                        Manage permissions
                      </button>
                      <button
                        onClick={() =>
                          handleRoleTransition(
                            member.id,
                            "MEMBER",
                            "Are you sure you want to demote this Moderator to an ordinary Member? All their Moderator permissions will be immediately revoked."
                          )
                        }
                        disabled={processingId === member.id} aria-busy={processingId === member.id}
                        className="ui-button ui-button--destructive w-full sm:w-auto"
                      >
                        <PendingLabel pending={!!(processingId === member.id)} idle="Return to Member" busy="Processing..." />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Permissions Editor Modal */}
      {editingModId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto"
        >
          <div className="bg-surface rounded-2xl shadow-dropdown max-w-md w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto border border-border">
            <h3 id="modal-title" className="text-lg font-bold text-text">
              Edit Moderator Permissions
            </h3>

            {modPermissions ? (
              <div className="space-y-4">
                <label className="flex items-center space-x-3 cursor-pointer p-2 rounded-control hover:bg-surface-secondary min-h-[44px]">
                  <input
                    type="checkbox"
                    checked={modPermissions.upload_official_documents}
                    onChange={(e) =>
                      setModPermissions({
                        ...modPermissions,
                        upload_official_documents: e.target.checked,
                      })
                    }
                    className="h-5 w-5 rounded border-border text-accent focus:ring-accent"
                  />
                  <span className="text-text text-sm font-medium">Publish official documents</span>
                </label>

                <label className="flex items-center space-x-3 cursor-pointer p-2 rounded-control hover:bg-surface-secondary min-h-[44px]">
                  <input
                    type="checkbox"
                    checked={modPermissions.create_announcements}
                    onChange={(e) =>
                      setModPermissions({
                        ...modPermissions,
                        create_announcements: e.target.checked,
                      })
                    }
                    className="h-5 w-5 rounded border-border text-accent focus:ring-accent"
                  />
                  <span className="text-text text-sm font-medium">Create announcements</span>
                </label>

                <label className="flex items-center space-x-3 cursor-pointer p-2 rounded-control hover:bg-surface-secondary min-h-[44px]">
                  <input
                    type="checkbox"
                    checked={modPermissions.manage_document_voting}
                    onChange={(e) =>
                      setModPermissions({
                        ...modPermissions,
                        manage_document_voting: e.target.checked,
                      })
                    }
                    className="h-5 w-5 rounded border-border text-accent focus:ring-accent"
                  />
                  <span className="text-text text-sm font-medium">Manage voting settings</span>
                </label>

                <div className="flex flex-col sm:flex-row justify-end gap-3 pt-4 border-t border-border">
                  <button
                    type="button"
                    onClick={() => setEditingModId(null)}
                    disabled={savingPerms}
                    className="ui-button ui-button--secondary w-full sm:w-auto"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSavePermissions}
                    disabled={savingPerms}
                    className="ui-button ui-button--primary w-full sm:w-auto"
                  >
                    <PendingLabel pending={!!(savingPerms)} idle="Save Permissions" busy="Saving..." />
                  </button>
                </div>
              </div>
            ) : (
              <div className="py-8 text-center text-text-muted text-sm">
                Loading permissions...
              </div>
            )}
          </div>
        </div>
      )}
    </PageContainer>
  );
}
