"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { fetchApi, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

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
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const loadSettings = useCallback(async (isInitial = false) => {
    if (!isInitial) setLoading(true);
    setError(null);
    try {
      const data = await fetchApi<SettingsResponse>("/api/v1/communities/irm/document-voting/settings");
      setInputValue(data.required_total_votes.toString());
      setAuthStatus(200);
    } catch (err) {
      if (err instanceof ApiError) {
        setAuthStatus(err.status);
        if (err.status === 401) {
          setError("Unauthorized. Please log in.");
        } else if (err.status === 403) {
          setError("Access denied. You need community management permissions to change voting settings.");
        } else {
          setError(`Failed to load settings: ${err.message}`);
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
    if (!authLoading) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadSettings(true);
    }
  }, [loadSettings, authLoading]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveMessage(null);

    // Client-side validation
    const trimmed = inputValue.trim();
    if (!/^\d+$/.test(trimmed)) {
      setSaveMessage({ type: 'error', text: 'Must be a positive whole number. No decimals or letters.' });
      return;
    }
    const val = parseInt(trimmed, 10);
    if (isNaN(val) || val < 1 || val > Number.MAX_SAFE_INTEGER) {
      setSaveMessage({ type: 'error', text: 'Must be a positive whole number within safe limits.' });
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
      setSaveMessage({ type: 'success', text: `Saved successfully! New threshold is ${data.required_total_votes}. Existing pending documents were unchanged.` });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 403) {
          setSaveMessage({ type: 'error', text: "Forbidden. You do not have permission to manage voting settings." });
          await refresh(); // Refresh context if revoked
        } else {
          setSaveMessage({ type: 'error', text: err.message });
        }
      } else if (err instanceof Error) {
        setSaveMessage({ type: 'error', text: err.message });
      } else {
        setSaveMessage({ type: 'error', text: 'Failed to save settings.' });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 sm:p-8 font-sans max-w-2xl mx-auto mt-6 sm:mt-10">
      {/* Breadcrumb Navigation */}
      <nav className="mb-4 text-sm flex flex-wrap items-center gap-1.5 text-gray-500" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-gray-900 hover:underline">
          IRM Hub
        </Link>
        <span>/</span>
        <Link href="/communities/irm/modules" className="hover:text-gray-900 hover:underline">
          Modules
        </Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">Voting Settings</span>
      </nav>

      <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Document Voting Settings</h1>
          <p className="text-sm text-gray-500 mt-1">Configure community voting thresholds.</p>
        </div>
        <Link href="/communities/irm/modules" className="text-blue-600 hover:underline text-sm font-medium">
          &larr; Back to Modules
        </Link>
      </div>

      {authLoading || loading ? (
        <div className="text-gray-500 py-8">Loading settings...</div>
      ) : error ? (
        <div className="p-5 bg-red-50 text-red-700 border border-red-200 rounded-xl flex flex-col gap-3 items-start">
          <p className="font-medium">{error}</p>
          <div className="flex flex-wrap gap-3 items-center pt-2">
            {authStatus === 401 && (
              <Link href="/login" className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors">
                Go to Login
              </Link>
            )}
            <Link href="/communities/irm/modules" className="text-sm text-gray-600 hover:text-gray-900 hover:underline">
              &larr; Back to Modules
            </Link>
            {authStatus !== 401 && authStatus !== 403 && (
              <button onClick={() => loadSettings(false)} className="bg-red-100 hover:bg-red-200 text-red-800 px-3 py-1.5 rounded-lg text-sm font-medium">
                Retry
              </button>
            )}
          </div>
        </div>
      ) : capabilities?.manage_document_voting ? (
        <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm">
          <div className="mb-6 space-y-2 text-sm text-gray-700 bg-blue-50 p-4 rounded border border-blue-100">
            <h2 className="font-semibold text-blue-900 mb-2">How Voting Works</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Total votes + strict majority rule:</strong> A document is approved if YES votes exceed NO votes <em>and</em> the required total vote threshold is reached.</li>
              <li><strong>Ties remain pending:</strong> If YES and NO votes are tied at or past the threshold, the document stays pending until a tie-breaking vote is cast.</li>
              <li><strong>Changes affect NEW uploads only:</strong> This threshold is captured when a document is uploaded. Existing documents retain the threshold they were saved with.</li>
            </ul>
          </div>

          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label htmlFor="threshold" className="block text-sm font-medium text-gray-700 mb-1">
                Required Total Votes (Community Default)
              </label>
              <input
                id="threshold"
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                className="w-full max-w-xs border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={saving}
              />
            </div>
            
            {saveMessage && (
              <div className={`p-3 text-sm rounded border ${
                saveMessage.type === 'success' ? 'bg-green-50 text-green-800 border-green-200' : 'bg-red-50 text-red-700 border-red-200'
              }`}>
                {saveMessage.text}
              </div>
            )}

            <button
              type="submit"
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-6 rounded disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Settings"}
            </button>
          </form>
        </div>
      ) : (
        <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded flex flex-col gap-2 items-start">
          Access denied. You need community management permissions to change voting settings.
        </div>
      )}
    </div>
  );
}
