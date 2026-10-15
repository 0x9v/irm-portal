"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { fetchApi } from "@/lib/api";
import { buttonStyles, PendingLabel } from "@/components/ui/Button";

export default function SavedDocumentButton({ documentId }: { documentId: string }) {
  const { user } = useAuth();
  const [saved, setSaved] = useState(false);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentUser = useRef(user?.id);

  useEffect(() => {
    currentUser.current = user?.id;
  }, [user?.id]);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!user) return;
    const requestedUser = user.id;
    setLoading(true);
    setError(null);
    try {
      const state = await fetchApi<{ saved: boolean }>(
        `/api/v1/communities/irm/documents/${encodeURIComponent(documentId)}/saved`,
        { signal },
      );
      if (!signal?.aborted && currentUser.current === requestedUser) {
        setSaved(state.saved);
        setOwnerId(requestedUser);
      }
    } catch (cause) {
      if (signal?.aborted || (cause instanceof Error && cause.name === "AbortError")) return;
      if (currentUser.current === requestedUser) setError("Could not check saved status. Retry to try again.");
    } finally {
      if (!signal?.aborted && currentUser.current === requestedUser) setLoading(false);
    }
  }, [documentId, user]);

  useEffect(() => {
    const controller = new AbortController();
    // Clear previous account state before loading this account's private state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaved(false);
    setOwnerId(null);
    setError(null);
    setPending(false);
    setLoading(true);
    if (!user) { setLoading(false); return () => controller.abort(); }
    void load(controller.signal);
    return () => controller.abort();
  }, [load, user]);

  const toggle = async () => {
    if (!user || pending || ownerId !== user.id) return;
    const requestedUser = user.id;
    setPending(true);
    setError(null);
    try {
      const next = await fetchApi<{ saved: boolean }>(
        `/api/v1/communities/irm/documents/${encodeURIComponent(documentId)}/saved`,
        { method: saved ? "DELETE" : "PUT" },
      );
      if (currentUser.current === requestedUser) setSaved(next.saved);
    } catch {
      if (currentUser.current === requestedUser) setError("Saved status could not be confirmed. Check it before changing it again.");
    } finally {
      if (currentUser.current === requestedUser) setPending(false);
    }
  };

  if (!user) return null;
  const currentState = ownerId === user.id;
  return (
    <div className="space-y-1">
      {error && <p role="alert" className="text-sm text-error">{error}</p>}
      <button
        type="button"
        onClick={() => currentState && !error ? void toggle() : void load()}
        disabled={loading || pending} aria-busy={loading || pending}
        aria-pressed={currentState && !error ? saved : undefined}
        className={buttonStyles(saved && currentState ? "secondary" : "quiet", "min-h-[44px]")}
      >
        <PendingLabel pending={loading || (!currentState && !error) || pending} idle={error ? "Check saved status" : saved ? "Saved · Remove" : "Save document"} busy={loading || (!currentState && !error) ? "Checking saved status…" : "Saving…"} />
      </button>
    </div>
  );
}
