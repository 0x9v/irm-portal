"use client";

import { PendingLabel } from "@/components/ui/Button";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { fetchApi, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import PageContainer from "@/components/PageContainer";
import Breadcrumbs from "@/components/Breadcrumbs";
import FeedbackMessage from "@/components/FeedbackMessage";

type SettingsResponse = {
  required_total_votes: number;
};

export default function DocumentVotingSettingsPage() {
  const { capabilities, isLoading: authLoading, refresh } = useAuth();
  
  const [inputValue, setInputValue] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: "success" | "error" | "warning"; text: string } | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const loadSettings = useCallback(async (isInitial = false) => {
    if (!isInitial) setLoading(true);
    setError(null);
    try {
      const data = await fetchApi<SettingsResponse>("/api/v1/communities/irm/document-voting/settings");
      setInputValue(data.required_total_votes.toString());
      setSaveMessage(null);
      setFieldError(null);
      setAuthStatus(200);
    } catch (err) {
      if (err instanceof ApiError) {
        setAuthStatus(err.status);
        if (err.status === 401) {
          setError("Unauthorized. Please log in.");
        } else if (err.status === 403) {
          setError("Access denied. You need community management permissions to change voting settings.");
        } else {
          setError("Voting settings could not be loaded. Please try again.");
        }
      } else if (err instanceof Error) {
        setError("Voting settings could not be loaded. Please try again.");
      } else {
        setError("An unexpected error occurred.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadSettings(true);
    }
  }, [loadSettings, authLoading]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveMessage(null);
    setFieldError(null);

    // Client-side validation
    const trimmed = inputValue.trim();
    if (!/^\d+$/.test(trimmed)) {
      setFieldError("Must be a positive whole number. No decimals or letters.");
      return;
    }
    const val = parseInt(trimmed, 10);
    if (isNaN(val) || val < 1 || val > Number.MAX_SAFE_INTEGER) {
      setFieldError("Must be a positive whole number within safe limits.");
      return;
    }

    setSaving(true);
    try {
      const data = await fetchApi<SettingsResponse>(
        "/api/v1/communities/irm/document-voting/settings",
        {
          method: "PATCH",
          body: JSON.stringify({ required_total_votes: val }),
        }
      );
      setInputValue(data.required_total_votes.toString());
      setSaveMessage({
        type: "success",
        text: `Saved successfully! New threshold is ${data.required_total_votes}. Existing pending documents were unchanged.`,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401 || err.status === 403) {
          setSaveMessage({ type: "error", text: err.status === 401 ? "Your session expired. Please log in again." : "You do not have permission to manage voting settings." });
          await refresh(); // Refresh context if revoked
        } else if (err.status === 422) {
          setFieldError("Check the required vote count and try again.");
        } else {
          setSaveMessage({ type: "warning", text: "The settings update could not be confirmed. Check the current threshold before saving again." });
        }
      } else {
        setSaveMessage({ type: "warning", text: "The settings update could not be confirmed. Check the current threshold before saving again." });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageContainer width="default">
      {/* Breadcrumb Navigation */}
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Modules", href: "/communities/irm/modules" },
          { label: "Voting Settings" },
        ]}
      />

      <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
        <div>
          <p className="ui-eyebrow">IRM / Management</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-text tracking-tight">Document Voting Settings</h1>
          <p className="text-sm text-text-muted mt-1">Configure community voting thresholds.</p>
        </div>
        <Link
          href="/communities/irm/modules"
          className="ui-button ui-button--secondary"
        >
          &larr; Back to Modules
        </Link>
      </div>

      {authLoading || loading ? (
        <div className="py-12 text-center text-text-muted text-sm">Loading settings...</div>
      ) : error ? (
        <div className="space-y-4">
          <FeedbackMessage
            type="error"
            message={error}
            onRetry={authStatus !== 401 && authStatus !== 403 ? () => loadSettings(false) : undefined}
            retryLabel="Retry Loading"
          />
          {authStatus === 401 && (
            <Link
              href="/login"
              className="ui-button ui-button--primary"
            >
              Go to Login
            </Link>
          )}
        </div>
      ) : capabilities?.manage_document_voting ? (
        <div className="p-6 sm:p-8 bg-surface border border-border rounded-surface shadow-none space-y-6">
          <div className="space-y-2 text-xs sm:text-sm text-text-muted bg-surface-secondary p-4 rounded-surface border border-border leading-relaxed">
            <h2 className="font-semibold text-text">How Voting Works</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>Total votes + strict majority rule:</strong> A document is approved if YES votes exceed NO votes <em>and</em> the required total vote threshold is reached.
              </li>
              <li>
                <strong>Ties remain pending:</strong> If YES and NO votes are tied at or past the threshold, the document stays pending until a tie-breaking vote is cast.
              </li>
              <li>
                <strong>Changes affect NEW uploads only:</strong> This threshold is captured when a document is uploaded. Existing documents retain the threshold they were saved with.
              </li>
            </ul>
          </div>

          <form onSubmit={handleSave} className="space-y-5">
            <div>
              <label htmlFor="threshold" className="block text-sm font-medium text-text mb-1">
                Required Total Votes (Community Default)
              </label>
              <input
                id="threshold"
                type="text"
                value={inputValue}
                onChange={(e) => { setInputValue(e.target.value); setFieldError(null); }}
                aria-invalid={Boolean(fieldError)}
                aria-describedby={fieldError ? "threshold-error" : undefined}
                className="w-full sm:max-w-xs bg-surface border border-border rounded-control p-2.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent"
                disabled={saving}
              />
              {fieldError && <p id="threshold-error" role="alert" className="ui-field-error">{fieldError}</p>}
            </div>
            
            {saveMessage && (
              <FeedbackMessage type={saveMessage.type} message={saveMessage.text}
                onRetry={saveMessage.type === "warning" ? () => loadSettings(false) : undefined} retryLabel="Check settings" />
            )}

            <button
              type="submit"
              disabled={saving} aria-busy={saving}
              className="ui-button ui-button--primary w-full sm:w-auto"
            >
              <PendingLabel pending={!!(saving)} idle="Save Settings" busy="Saving..." />
            </button>
          </form>
        </div>
      ) : (
        <FeedbackMessage
          type="error"
          message="Access denied. You need community management permissions to change voting settings."
        />
      )}
    </PageContainer>
  );
}
