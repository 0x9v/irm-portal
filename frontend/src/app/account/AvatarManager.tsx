"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import FeedbackMessage, { type FeedbackType } from "@/components/FeedbackMessage";
import ConfirmationDialog from "@/components/moderation/ConfirmationDialog";
import Button, { PendingLabel } from "@/components/ui/Button";
import type { AuthContextValue, User } from "@/context/AuthContext";
import { ApiError, fetchApi } from "@/lib/api";
import { avatarFileError, hasAvatarResponse, isOwnedAvatarUrl } from "@/lib/avatarManagement";
import { useAsyncScope } from "@/lib/useAsyncScope";
import styles from "./AccountPage.module.css";

type Notice = { type: FeedbackType; message: string };
type Selection = { file: File; previewUrl: string };

export default function AvatarManager({ userId, avatarUrl, loggingOut, refresh, onConfirmed, onReconciled }: {
  userId: string;
  avatarUrl: string | null;
  loggingOut: boolean;
  refresh: AuthContextValue["refresh"];
  onConfirmed: (url: string | null, operation: "uploaded" | "removed") => void;
  onReconciled: (url: string | null) => void;
}) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState<"upload" | "remove" | null>(null);
  const [checking, setChecking] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const previewUrl = useRef<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const submitting = useRef(false);
  const captureScope = useAsyncScope(`${userId}:${loggingOut}`);

  const clearSelection = () => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null;
    if (fileInput.current) fileInput.current.value = "";
    setSelection(null);
    setPreviewFailed(false);
  };

  useEffect(() => () => {
    activeRequest.current?.abort();
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- A logout must erase an unsaved local photo and invalidate its operation. */
  useEffect(() => {
    if (!loggingOut) return;
    activeRequest.current?.abort();
    activeRequest.current = null;
    submitting.current = false;
    clearSelection();
    setNotice(null);
    setPending(null);
    setChecking(false);
    setRemoveOpen(false);
    setUncertain(false);
  }, [loggingOut]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const selectFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // The same file can be selected again after Cancel.
    if (!file || pending || checking || submitting.current) return;
    const validation = avatarFileError(file);
    if (validation) {
      clearSelection();
      setNotice({ type: "error", message: validation });
      setUncertain(false);
      return;
    }
    clearSelection();
    const url = URL.createObjectURL(file);
    previewUrl.current = url;
    setSelection({ file, previewUrl: url });
    setNotice(null);
    setUncertain(false);
  };

  const refreshAfterConfirmed = async (expected: string | null, operation: "uploaded" | "removed", isCurrent: () => boolean) => {
    try {
      const result = await refresh();
      if (!isCurrent()) return;
      if (result.user?.id !== userId) {
        setNotice({ type: "warning", message: `Photo ${operation}, but your account could not be refreshed. Retry the account check.` });
      } else {
        onReconciled(result.user.avatar_url);
        if (result.user.avatar_url !== expected) {
          setNotice({ type: "info", message: `Photo ${operation}. Your account now shows a different saved photo; review the current image.` });
        }
      }
    } catch {
      if (isCurrent()) setNotice({ type: "warning", message: `Photo ${operation}, but your account could not be refreshed. Retry the account check.` });
    }
  };

  const mutate = async (operation: "upload" | "remove") => {
    if (submitting.current || pending || checking || loggingOut || uncertain) return;
    if (operation === "upload" && !selection) return;
    if (operation === "remove" && !avatarUrl) return;
    const isCurrent = captureScope();
    const controller = new AbortController();
    activeRequest.current = controller;
    submitting.current = true;
    setPending(operation);
    setNotice(null);
    try {
      const form = new FormData();
      if (operation === "upload") form.append("file", selection!.file);
      const response = await fetchApi<unknown>("/api/v1/auth/me/avatar", {
        method: operation === "upload" ? "PUT" : "DELETE",
        ...(operation === "upload" ? { body: form } : {}),
        signal: controller.signal,
      }, 200, operation === "remove" ? "none" : "json");
      if (!isCurrent()) return;
      if (!hasAvatarResponse(response) || (operation === "upload"
        ? !isOwnedAvatarUrl(response.avatar_url, userId) : response.avatar_url !== null)) {
        throw new Error("Unexpected avatar response");
      }
      const savedUrl = response.avatar_url;
      const pastTense = operation === "upload" ? "uploaded" : "removed";
      onConfirmed(savedUrl, pastTense);
      clearSelection();
      setRemoveOpen(false);
      setUncertain(false);
      setNotice({ type: "success", message: operation === "upload" ? "Photo uploaded." : "Photo removed." });
      await refreshAfterConfirmed(savedUrl, pastTense, isCurrent);
    } catch (error) {
      if (!isCurrent() || (error instanceof Error && error.name === "AbortError")) return;
      setRemoveOpen(false);
      if (error instanceof ApiError) {
        if (error.status === 401) {
          clearSelection();
          setNotice({ type: "error", message: "Your session expired. Sign in again to manage your photo." });
          void refresh();
        } else if (error.status === 413) {
          setNotice({ type: "error", message: operation === "upload"
            ? "The image is too large. Choose a smaller JPEG or PNG, up to 2 MiB."
            : "The removal request was too large. Reload the page before trying again." });
        } else if (error.status === 400 || error.status === 415 || error.status === 422) {
          setNotice({ type: "error", message: operation === "upload"
            ? "The image could not be accepted. Choose a valid JPEG or PNG and try again."
            : "The removal request could not be accepted. Reload the page before trying again." });
        } else if (error.status === 403) {
          setNotice({ type: "error", message: "This request was not authorized. Reload the page before trying again." });
        } else if (error.status >= 500) {
          setUncertain(true);
          setNotice({ type: "warning", message: "We couldn’t confirm whether the saved photo changed. Check the current photo before trying again." });
        } else {
          setNotice({ type: "error", message: "Your photo could not be updated. Please review it and try again." });
        }
      } else {
        setUncertain(true);
        setNotice({ type: "warning", message: "We couldn’t confirm whether the saved photo changed. Check the current photo before trying again." });
      }
    } finally {
      if (isCurrent()) {
        activeRequest.current = null;
        submitting.current = false;
        setPending(null);
      }
    }
  };

  const checkSavedPhoto = async () => {
    if (checking || pending || submitting.current) return;
    const isCurrent = captureScope();
    const controller = new AbortController();
    activeRequest.current = controller;
    setChecking(true);
    try {
      const current = await fetchApi<User>("/api/v1/auth/me", { signal: controller.signal });
      if (!isCurrent()) return;
      if (current.id !== userId) {
        clearSelection();
        void refresh();
        return;
      }
      onReconciled(current.avatar_url);
      clearSelection();
      setUncertain(false);
      setNotice({ type: "info", message: current.avatar_url === avatarUrl
        ? "Your currently saved photo is unchanged. The earlier request result is still unknown."
        : "Your currently saved photo has changed. The earlier request result is still unknown." });
      await refresh();
    } catch {
      if (isCurrent()) setNotice({ type: "warning", message: "We couldn’t check the saved photo. Try checking again before another change." });
    } finally {
      if (isCurrent()) {
        activeRequest.current = null;
        setChecking(false);
      }
    }
  };

  return <div className={styles.avatarControls}>
    <input ref={fileInput} type="file" accept="image/jpeg,image/png" hidden
      onChange={selectFile} disabled={!!pending || checking || loggingOut} />
    <div className={styles.avatarActions}>
      <Button type="button" variant="secondary" disabled={!!pending || checking || uncertain || loggingOut}
        onClick={() => fileInput.current?.click()}>{avatarUrl ? "Change photo" : "Add photo"}</Button>
      {avatarUrl && !selection && <Button type="button" variant="quiet" disabled={!!pending || checking || uncertain || loggingOut}
        onClick={() => setRemoveOpen(true)}>Remove photo</Button>}
    </div>
    <p className={styles.avatarHint}>JPEG or PNG, maximum 2 MiB. We create a square profile picture. Signed-in users who receive its URL can view it.</p>
    {notice && <FeedbackMessage type={notice.type} message={notice.message} />}
    {uncertain && <Button type="button" variant="secondary" pending={checking} onClick={() => { void checkSavedPhoto(); }}>
      <PendingLabel pending={checking} idle="Check saved photo" busy="Checking…" />
    </Button>}
    {selection && <div className={`${styles.avatarPreview} ui-motion-inline`}>
      <div>
        <h3>Local preview — not uploaded</h3>
        <p>Your saved account photo stays in place until Upload photo succeeds.</p>
      </div>
      {previewFailed ? <p className={styles.avatarPreviewFallback}>Preview unavailable. The server will check the image if you upload it.</p> :
        // eslint-disable-next-line @next/next/no-img-element
        <img src={selection.previewUrl} alt="Selected photo preview, not uploaded" onError={() => setPreviewFailed(true)} />}
      <div className={styles.formActions}>
        <Button type="button" pending={pending === "upload"} disabled={!!pending || checking || uncertain}
          onClick={() => { void mutate("upload"); }}><PendingLabel pending={pending === "upload"} idle="Upload photo" busy="Uploading…" /></Button>
        <Button type="button" variant="secondary" disabled={!!pending || checking}
          onClick={() => { clearSelection(); setNotice(null); setUncertain(false); }}>Cancel</Button>
      </div>
    </div>}
    {removeOpen && <ConfirmationDialog title="Remove photo" heading="Remove your account photo?"
      description="Your account will show your username initials until you upload another photo."
      pending={pending === "remove"} error={null} onCancel={() => setRemoveOpen(false)}
      onConfirm={() => { void mutate("remove"); }} onCheck={() => { void checkSavedPhoto(); }} />}
  </div>;
}
