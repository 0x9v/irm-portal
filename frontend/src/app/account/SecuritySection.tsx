"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import FeedbackMessage from "@/components/FeedbackMessage";
import Button, { iconButtonStyles, PendingLabel } from "@/components/ui/Button";
import { useAuth } from "@/context/AuthContext";
import { ApiError, fetchApi } from "@/lib/api";
import { type PasswordDraft, type PasswordErrors, type PasswordField,
  passwordServerErrors, validatePasswordChange } from "@/lib/passwordChange";
import { useAsyncScope } from "@/lib/useAsyncScope";
import styles from "./AccountPage.module.css";

const emptyDraft = (): PasswordDraft => ({ current_password: "", new_password: "", confirm_password: "" });
const fields: { key: PasswordField; label: string; autocomplete: string }[] = [
  { key: "current_password", label: "Current password", autocomplete: "current-password" },
  { key: "new_password", label: "New password", autocomplete: "new-password" },
  { key: "confirm_password", label: "Confirm new password", autocomplete: "new-password" },
];

export default function SecuritySection({ userId, loggingOut }: { userId: string; loggingOut: boolean }) {
  const router = useRouter();
  const { clearAuthenticatedState } = useAuth();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PasswordDraft>(emptyDraft);
  const [errors, setErrors] = useState<PasswordErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [pending, setPending] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);
  const submitting = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);
  const captureScope = useAsyncScope(`${userId}:${loggingOut}`);

  useEffect(() => () => { activeRequest.current?.abort(); }, []);
  /* eslint-disable react-hooks/set-state-in-effect -- Logout invalidates and erases the current password draft immediately. */
  useEffect(() => {
    if (!loggingOut) return;
    activeRequest.current?.abort();
    activeRequest.current = null;
    submitting.current = false;
    setDraft(emptyDraft());
    setErrors({});
    setNotice(null);
    setUncertain(false);
    setEditing(false);
    setPending(false);
    setShowPasswords(false);
  }, [loggingOut]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const closeForm = () => {
    setDraft(emptyDraft());
    setErrors({});
    setNotice(null);
    setUncertain(false);
    setShowPasswords(false);
    setEditing(false);
  };

  const clearSessionAndNavigate = (passwordChanged: boolean) => {
    let cleared = false;
    flushSync(() => { cleared = clearAuthenticatedState(userId, passwordChanged); });
    if (cleared) router.replace("/login");
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current || pending || loggingOut) return;
    const validation = validatePasswordChange(draft);
    setErrors(validation);
    setNotice(null);
    if (Object.keys(validation).length) return;

    const isCurrent = captureScope();
    const controller = new AbortController();
    activeRequest.current = controller;
    submitting.current = true;
    setPending(true);
    try {
      await fetchApi<void>("/api/v1/auth/me/password", {
        method: "POST",
        body: JSON.stringify({ current_password: draft.current_password, new_password: draft.new_password }),
        signal: controller.signal,
      }, 204);
      if (!isCurrent()) return;
      closeForm();
      clearSessionAndNavigate(true);
    } catch (error) {
      if (!isCurrent() || (error instanceof Error && error.name === "AbortError")) return;
      if (error instanceof ApiError) {
        if (error.status === 401) {
          closeForm();
          clearSessionAndNavigate(false);
          return;
        }
        if (error.status === 400 || error.status === 422) {
          const mapped = passwordServerErrors(error);
          setErrors(mapped);
          if (!Object.keys(mapped).length) setNotice("Review the password fields and try again.");
        } else if (error.status === 403) {
          setNotice("This request was not authorized. Reload the page before trying again.");
        } else if (error.status === 413) {
          setNotice("The request is too large. Use shorter passwords and try again.");
        } else if (error.status >= 500) {
          setDraft(emptyDraft());
          setEditing(false);
          setUncertain(true);
        } else {
          setNotice("Your password could not be changed. Review the fields and try again.");
        }
      } else {
        setDraft(emptyDraft());
        setEditing(false);
        setUncertain(true);
      }
    } finally {
      if (isCurrent()) {
        submitting.current = false;
        activeRequest.current = null;
        setPending(false);
      }
    }
  };

  return <section className={styles.securityCard} aria-labelledby="security-heading">
    <div className={styles.detailsHeading}>
      <h2 id="security-heading">Security</h2>
      {!editing && !uncertain && <Button type="button" variant="secondary" onClick={() => { setEditing(true); setNotice(null); }}>
        Change password
      </Button>}
    </div>
    {!editing && !uncertain && <p className={styles.securityIntro}>Update the password for your EtudSup account.</p>}
    {uncertain && <div className={styles.securityFeedback}>
      <FeedbackMessage type="warning" message="We couldn’t confirm the result. Try signing in with your new password." />
      <Button type="button" variant="secondary" onClick={() => { closeForm(); clearSessionAndNavigate(false); }}>Sign in</Button>
    </div>}
    {editing && <div className={`${styles.securityFormArea} ui-motion-inline`}>
      <p className={styles.securityIntro}>Changing your password signs you out on all devices. You’ll need to sign in again.</p>
      {notice && <FeedbackMessage type="error" message={notice} />}
      <form onSubmit={submit} noValidate className={styles.form}>
        <div className={styles.passwordVisibility}>
          <button type="button" className={iconButtonStyles()} aria-label={showPasswords ? "Hide passwords" : "Show passwords"}
            aria-pressed={showPasswords} disabled={pending} onClick={() => setShowPasswords(value => !value)}>
            {showPasswords ? <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.7 2.7"/><path d="M8.5 5.1A10.9 10.9 0 0 1 12 4.5c5.2 0 9 4.2 10 7.5a11 11 0 0 1-3 4.8M6 6.4A11.2 11.2 0 0 0 2 12c1 3.3 4.8 7.5 10 7.5 1.5 0 2.9-.3 4.1-.9"/></svg>
              : <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.8-7.5 10-7.5S22 12 22 12s-3.8 7.5-10 7.5S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>}
          </button>
        </div>
        {fields.map(({ key, label, autocomplete }) => <div key={key} className={styles.field}>
          <label className="ui-label" htmlFor={`security-${key}`}>{label}</label>
          <input id={`security-${key}`} name={key} type={showPasswords ? "text" : "password"} autoComplete={autocomplete}
            className="ui-field" value={draft[key]} disabled={pending} required
            onChange={event => { setDraft(current => ({ ...current, [key]: event.target.value }));
              setErrors(current => ({ ...current, [key]: undefined })); setNotice(null); }}
            aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `security-${key}-error` : undefined} />
          {errors[key] && <p id={`security-${key}-error`} className="ui-field-error" role="alert">{errors[key]}</p>}
        </div>)}
        <div className={styles.formActions}>
          <Button type="submit" pending={pending}><PendingLabel pending={pending} idle="Change password" busy="Changing…" /></Button>
          <Button type="button" variant="secondary" disabled={pending} onClick={closeForm}>Cancel</Button>
        </div>
      </form>
    </div>}
  </section>;
}
