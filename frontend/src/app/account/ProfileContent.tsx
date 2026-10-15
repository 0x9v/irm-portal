"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import AccountAvatar from "@/components/account/AccountAvatar";
import FeedbackMessage from "@/components/FeedbackMessage";
import Button, { PendingLabel } from "@/components/ui/Button";
import type { User, AuthContextValue } from "@/context/AuthContext";
import { ApiError, fetchApi } from "@/lib/api";
import { profileChanges, profileFields, profileServerErrors, validateProfileChanges,
  type ProfileErrors, type ProfileField, type ProfileFields } from "@/lib/profileEditing";
import { useAsyncScope } from "@/lib/useAsyncScope";
import SecuritySection from "./SecuritySection";
import AvatarManager from "./AvatarManager";
import CommunityMembershipSection from "@/components/account/CommunityMembershipSection";
import styles from "./AccountPage.module.css";

type Notice = { type: "success" | "info" | "warning" | "error"; message: string };
const fieldList: { key: ProfileField; label: string; placeholder: string; hint: string; autocomplete: string }[] = [
  { key: "username", label: "Username", placeholder: "e.g. sara_elm", hint: "Shown beside your community contributions. Use 3 to 50 characters.", autocomplete: "username" },
  { key: "first_name", label: "First name", placeholder: "e.g. Sara", hint: "Your account name is separate from submitted membership applications.", autocomplete: "given-name" },
  { key: "family_name", label: "Family name", placeholder: "e.g. El Mansouri", hint: "Use 1 to 100 characters for each name.", autocomplete: "family-name" },
];

function provided(value: string | null | undefined) {
  return value?.trim() ? value : "Not provided";
}

function sameProfile(a: ProfileFields, b: ProfileFields) {
  return a.username === b.username && a.first_name === b.first_name && a.family_name === b.family_name;
}

export default function ProfileContent({ user, masked, loggingOut, authError, refresh }: {
  user: User;
  masked: boolean;
  loggingOut: boolean;
  authError: string | null;
  refresh: AuthContextValue["refresh"];
}) {
  const [baseline, setBaseline] = useState<User>(user);
  const [draft, setDraft] = useState<ProfileFields>(() => profileFields(user));
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [checkingSaved, setCheckingSaved] = useState(false);
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [externalChange, setExternalChange] = useState(false);
  const [confirmedSave, setConfirmedSave] = useState(false);
  const [avatarOutcome, setAvatarOutcome] = useState<"uploaded" | "removed" | null>(null);
  const [uncertain, setUncertain] = useState<Partial<ProfileFields> | null>(null);
  const submitting = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);
  const captureScope = useAsyncScope(`${user.id}:${loggingOut}`);
  const observedUser = useRef(user);
  const avatarGeneration = useRef(0);
  const avatarOverride = useRef<{ url: string | null } | null>(null);

  const onAvatarConfirmed = (url: string | null, operation: "uploaded" | "removed") => {
    avatarGeneration.current++;
    avatarOverride.current = { url };
    setBaseline(current => ({ ...current, avatar_url: url }));
    setAvatarOutcome(operation);
  };

  const onAvatarReconciled = (url: string | null) => {
    avatarGeneration.current++;
    avatarOverride.current = null;
    setBaseline(current => ({ ...current, avatar_url: url }));
    setAvatarOutcome(null);
  };

  useEffect(() => () => { activeRequest.current?.abort(); }, []);

  useEffect(() => {
    if (loggingOut) activeRequest.current?.abort();
  }, [loggingOut]);

  useEffect(() => {
    const previousUser = observedUser.current;
    observedUser.current = user;
    if (avatarOverride.current?.url === user.avatar_url) avatarOverride.current = null;
    const snapshot = avatarOverride.current ? { ...user, avatar_url: avatarOverride.current.url } : user;
    if (user === previousUser || user.id !== previousUser.id ||
      (sameProfile(profileFields(snapshot), profileFields(baseline)) &&
        snapshot.email === baseline.email && snapshot.avatar_url === baseline.avatar_url)) return;
    const dirty = Object.keys(profileChanges(draft, profileFields(baseline))).length > 0;
    // A same-account refresh updates the baseline. Typed edits stay intact.
    setBaseline(snapshot);
    if (dirty) setExternalChange(true);
    else { setDraft(profileFields(snapshot)); setExternalChange(false); }
  }, [user, baseline, draft]);

  const changes = profileChanges(draft, profileFields(baseline));
  const changed = Object.keys(changes).length > 0;

  const cancel = () => {
    if (pending || checkingSaved) return;
    setDraft(profileFields(baseline));
    setEditing(false);
    setErrors({});
    setNotice(null);
    setExternalChange(false);
    setUncertain(null);
    setConfirmedSave(false);
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current || pending || checkingSaved) return;
    const submitted = profileChanges(draft, profileFields(baseline));
    const avatarAtStart = avatarGeneration.current;
    if (!Object.keys(submitted).length) return;
    const validation = validateProfileChanges(draft, profileFields(baseline));
    setErrors(validation);
    setNotice(null);
    setUncertain(null);
    setConfirmedSave(false);
    if (Object.keys(validation).length) return;

    const isCurrent = captureScope();
    const controller = new AbortController();
    activeRequest.current = controller;
    submitting.current = true;
    setPending(true);
    try {
      const response = await fetchApi<User>("/api/v1/auth/me", {
        method: "PATCH", body: JSON.stringify(submitted), signal: controller.signal,
      });
      if (!isCurrent()) return;
      if (response.id !== user.id) {
        setNotice({ type: "warning", message: "The account changed while saving. Check your current account before editing again." });
        void refresh();
        return;
      }
      setBaseline(current => ({ ...response, avatar_url: avatarGeneration.current !== avatarAtStart
        ? current.avatar_url : avatarOverride.current ? avatarOverride.current.url
          : "avatar_url" in response ? response.avatar_url : current.avatar_url }));
      setDraft(profileFields(response));
      setEditing(false);
      setErrors({});
      setExternalChange(false);
      setConfirmedSave(true);
      setNotice({ type: "success", message: "Profile changes saved." });
      // AuthContext returns a result for both success and failure; it does not throw for HTTP failures.
      try {
        const refreshed = await refresh();
        if (!isCurrent()) return;
        if (!refreshed.user || refreshed.user.id !== user.id) {
          setNotice({ type: "warning", message: "Profile changes were saved, but your account could not be refreshed. Retry the account check." });
        } else if (!sameProfile(profileFields(refreshed.user), profileFields(response))) {
          setNotice({ type: "info", message: "Profile changes were saved, and the current account changed again during refresh." });
        }
      } catch {
        if (isCurrent()) setNotice({ type: "warning", message: "Profile changes were saved, but your account could not be refreshed. Retry the account check." });
      }
    } catch (error) {
      if (!isCurrent()) return;
      if (error instanceof ApiError) {
        if (error.status === 409) {
          setErrors({ username: "Username is already taken." });
        } else if (error.status === 422) {
          const mapped = profileServerErrors(error);
          setErrors(mapped);
          if (!Object.keys(mapped).length) setNotice({ type: "error", message: "Review the profile fields and try again." });
        } else if (error.status === 401) {
          setNotice({ type: "error", message: "Your session expired. Sign in again to edit your profile." });
          void refresh();
        } else if (error.status === 403) {
          setNotice({ type: "error", message: "This request was not authorized. Reload the page before trying again." });
        } else if (error.status >= 500) {
          setUncertain(submitted);
          setNotice({ type: "warning", message: "We could not confirm whether your changes were saved. Check the current profile before trying again." });
        } else {
          setNotice({ type: "error", message: "Your changes could not be saved. Review them and try again." });
        }
      } else {
        setUncertain(submitted);
        setNotice({ type: "warning", message: "We could not confirm whether your changes were saved. Check the current profile before trying again." });
      }
    } finally {
      if (isCurrent()) {
        submitting.current = false;
        activeRequest.current = null;
        setPending(false);
      }
    }
  };

  const checkSavedProfile = async () => {
    if (!uncertain || pending || checkingSaved) return;
    const submitted = uncertain;
    const avatarAtStart = avatarGeneration.current;
    const isCurrent = captureScope();
    const controller = new AbortController();
    activeRequest.current = controller;
    setCheckingSaved(true);
    try {
      const current = await fetchApi<User>("/api/v1/auth/me", { signal: controller.signal });
      if (!isCurrent()) return;
      if (current.id !== user.id) {
        setNotice({ type: "warning", message: "The signed-in account changed. Checking the current account now." });
        void refresh();
        return;
      }
      const matches = (Object.keys(submitted) as ProfileField[]).every(field => current[field] === submitted[field]);
      setBaseline(previous => ({ ...current, avatar_url: avatarGeneration.current !== avatarAtStart
        ? previous.avatar_url : avatarOverride.current ? avatarOverride.current.url : current.avatar_url }));
      setExternalChange(false);
      setNotice({ type: "info", message: matches
        ? "The current profile matches the values you submitted. The original save response was not received."
        : "The current profile differs from the values you submitted. Review the fields before saving again." });
      // This read also reconciles the shared identity without sending another PATCH.
      await refresh();
    } catch {
      if (isCurrent()) setNotice({ type: "warning", message: "The current profile could not be checked. Keep your edits and try checking again." });
    } finally {
      if (isCurrent()) {
        activeRequest.current = null;
        setCheckingSaved(false);
      }
    }
  };

  return <>
    {masked && authError && <FeedbackMessage type={confirmedSave || avatarOutcome ? "warning" : "error"}
      message={avatarOutcome ? `Photo ${avatarOutcome}, but your account could not be refreshed.` : confirmedSave
        ? "Profile changes were saved, but your account could not be refreshed." : "We couldn't check your account. Please try again."}
      onRetry={() => { void refresh().then(result => {
        if (avatarOutcome && result.user?.id === user.id) onAvatarReconciled(result.user.avatar_url);
        if (confirmedSave && result.user?.id === user.id) setNotice({ type: "success", message: "Profile changes saved." });
      }); }} retryLabel="Retry account check" />}
    <div hidden={masked} className={styles.profileContent}>
      {notice && <FeedbackMessage type={notice.type} message={notice.message} />}
      <section className={styles.identityCard} aria-labelledby="identity-heading">
        <AccountAvatar userId={baseline.id} username={baseline.username} avatarUrl={baseline.avatar_url} />
        <div className={styles.identityText}>
          <h2 id="identity-heading">{provided(baseline.username)}</h2>
          <p>EtudSup account</p>
          <AvatarManager userId={user.id} avatarUrl={baseline.avatar_url} loggingOut={loggingOut}
            refresh={refresh} onConfirmed={onAvatarConfirmed} onReconciled={onAvatarReconciled} />
        </div>
      </section>
      <section className={styles.detailsCard} aria-labelledby="details-heading">
        <div className={styles.detailsHeading}>
          <h2 id="details-heading">Profile details</h2>
          {!editing && <Button type="button" variant="secondary" onClick={() => { setDraft(profileFields(baseline)); setEditing(true); setErrors({}); setNotice(null); setUncertain(null); setConfirmedSave(false); }}>Edit profile</Button>}
        </div>
        <dl className={styles.details}>
          <div><dt>Username</dt><dd>{provided(baseline.username)}</dd></div>
          <div><dt>First name</dt><dd>{provided(baseline.first_name)}</dd></div>
          <div><dt>Family name</dt><dd>{provided(baseline.family_name)}</dd></div>
          <div><dt>Email</dt><dd>{provided(baseline.email)}</dd></div>
        </dl>
      </section>
      {editing && <section className={`${styles.editCard} ui-motion-inline`} aria-labelledby="edit-heading">
        <h2 id="edit-heading">Edit profile</h2>
        <p className={styles.editIntro}>Update the name people see on your EtudSup account.</p>
        {externalChange && <FeedbackMessage type="info" message="Your saved profile changed while you were editing. Your typed values are still here; review them before saving." />}
        <form onSubmit={save} noValidate className={styles.form}>
          {fieldList.map(({ key, label, placeholder, hint, autocomplete }) => <div key={key} className={styles.field}>
            <label className="ui-label" htmlFor={`profile-${key}`}>{label}</label>
            <input id={`profile-${key}`} name={key} className="ui-field" value={draft[key]}
              onChange={event => { setDraft(current => ({ ...current, [key]: event.target.value })); setErrors(current => ({ ...current, [key]: undefined })); setNotice(null); setUncertain(null); setConfirmedSave(false); }}
              placeholder={placeholder} autoComplete={autocomplete} disabled={pending || checkingSaved}
              aria-invalid={!!errors[key]} aria-describedby={`profile-${key}-hint${errors[key] ? ` profile-${key}-error` : ""}`} />
            <p id={`profile-${key}-hint`} className={styles.hint}>{hint}</p>
            {errors[key] && <p id={`profile-${key}-error`} className="ui-field-error" role="alert">{errors[key]}</p>}
          </div>)}
          <div className={styles.formActions}>
            <Button type="submit" pending={pending} disabled={!changed || checkingSaved}>
              <PendingLabel pending={pending} idle="Save changes" busy="Saving…" />
            </Button>
            <Button type="button" variant="secondary" disabled={pending || checkingSaved} onClick={cancel}>Cancel</Button>
          </div>
        </form>
        {uncertain && <Button type="button" variant="secondary" pending={checkingSaved} disabled={pending} onClick={() => { void checkSavedProfile(); }}>
          <PendingLabel pending={checkingSaved} idle="Check saved profile" busy="Checking…" />
        </Button>}
      </section>}
      <CommunityMembershipSection masked={masked} />
      <SecuritySection userId={user.id} loggingOut={loggingOut} />
    </div>
  </>;
}
