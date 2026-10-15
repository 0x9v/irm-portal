"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { fetchApi, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { formatFormError, FormErrors } from "@/lib/validation";
import { useAsyncScope } from "@/lib/useAsyncScope";
import AccessDeniedGuidance from "@/components/AccessDeniedGuidance";
import FeedbackMessage from "@/components/FeedbackMessage";
import styles from "@/app/account/AccountPage.module.css";

type ApplicantType = "STUDENT" | "LAUREATE";
type IdentifierType = "MASSAR" | "FOREIGN";
type ApplicationOptions = {
  current_academic_year_start: number;
  applicant_types: ApplicantType[];
  student_identifier_types: IdentifierType[];
  promotion_options: string[];
  custom_promotion_formats: string[];
};

function nameError(value: string): string | undefined {
  const normalized = value.trim();
  if (!normalized) return "This field is required.";
  if ([...normalized].length > 100) return "Use no more than 100 characters.";
  if (/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/u.test(normalized)) return "Control characters and line breaks are not allowed.";
  return undefined;
}

function promotionError(value: string, currentYear: number): string | undefined {
  const input = value.trim();
  if (!input) return "Promotion is required.";
  const match = /^(\d{2}|\d{4})(?:\/(\d{2}|\d{4}))?$/.exec(input);
  if (!match) return "Use YYYY, YY, YYYY/YYYY, or YY/YY.";
  const start = Number(match[1].length === 2 ? `20${match[1]}` : match[1]);
  if (match[2]) {
    if (match[1].length !== match[2].length) return "Both years must use the same format.";
    const end = Number(match[2].length === 2 ? `20${match[2]}` : match[2]);
    if (end !== start + 1) return "Promotion years must be consecutive.";
    if (end > currentYear) return `Graduation year must be no later than ${currentYear}.`;
  } else if (start > currentYear) return `Graduation year must be no later than ${currentYear}.`;
  return undefined;
}

export default function CommunityMembershipSection({ masked }: { masked: boolean }) {
  const { user, membership, membershipError, error: authError, refresh } = useAuth();
  
  const [applicantType, setApplicantType] = useState<ApplicantType | "">("");
  const [firstName, setFirstName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [identifierType, setIdentifierType] = useState<IdentifierType>("MASSAR");
  const [cne, setCne] = useState("");
  const [promotion, setPromotion] = useState("");
  const [customPromotion, setCustomPromotion] = useState(false);
  const [applicationOptions, setApplicationOptions] = useState<ApplicationOptions | null>(null);
  const [optionsState, setOptionsState] = useState<"loading" | "ready" | "error">("loading");
  const [loading, setLoading] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "error" | "success" | "info" } | null>(null);
  const [errors, setErrors] = useState<FormErrors>({ fields: {} });

  const captureScope = useAsyncScope(`${user?.id}:${membership?.status}:${membershipError}:${authError}:${masked}`);
  const canApply = !masked && !membershipError && !authError && !!user && (!membership || membership.status === "REJECTED" || membership.status === "REMOVED");
  const userId = user?.id;
  useEffect(() => {
    if (!masked && window.location.hash === "#community-membership") {
      requestAnimationFrame(() => document.getElementById("community-membership")?.scrollIntoView());
    }
  }, [masked]);
  useEffect(() => {
    if (!userId || masked || !canApply) return;
    const controller = new AbortController();
    let current = true;
    fetchApi<ApplicationOptions>("/api/v1/communities/irm/membership/application-options", { signal: controller.signal })
      .then((options) => {
        if (!current) return;
        setApplicationOptions(options);
        setOptionsState(options.promotion_options.length ? "ready" : "error");
      })
      .catch(() => { if (current) { setApplicationOptions(null); setOptionsState("error"); } });
    return () => { current = false; controller.abort(); };
  }, [userId, masked, canApply]);
  useEffect(() => {
    // Discard protected form data when account or observed access changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setApplicantType(""); setFirstName(""); setFamilyName(""); setIdentifierType("MASSAR"); setCne(""); setPromotion(""); setCustomPromotion(false); setConfirmCancel(false); setMessage(null); setErrors({ fields: {} }); setLoading(false); setCanceling(false);
  }, [user?.id, membership?.status, membershipError, authError]);

  const handleCancelRequest = async () => {
    const isCurrent = captureScope();
    if (masked || !membership?.id || membership.status !== "PENDING" || canceling) return;
    setCanceling(true);
    setMessage(null);
    try {
      await fetchApi<void>(`/api/v1/communities/irm/membership/${membership.id}`, {
        method: "DELETE",
      });
      if (!isCurrent()) return;
      setMessage({ text: "Pending membership request canceled successfully. You may apply again.", type: "success" });
      await refresh();
    } catch (err) {
      if (!isCurrent()) return;
      if (err instanceof ApiError) {
        if (err.status === 401 || err.status === 403) {
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
      if (isCurrent()) { setCanceling(false); setConfirmCancel(false); }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canApply || loading || !applicantType) return;
    const clientErrors: Record<string, string> = {};
    const firstNameError = nameError(firstName);
    const familyNameError = nameError(familyName);
    if (firstNameError) clientErrors.applicant_first_name = firstNameError;
    if (familyNameError) clientErrors.applicant_family_name = familyNameError;
    const normalizedCne = cne.trim();
    if (applicantType === "STUDENT") {
      if (!normalizedCne || (identifierType === "MASSAR" ? !/^[A-Za-z][0-9]{9}$/.test(normalizedCne) : !/^[A-Za-z0-9]{1,50}$/.test(normalizedCne))) {
        clientErrors.cne = identifierType === "MASSAR" ? "Use one letter followed by nine digits." : "Use 1–50 ASCII letters or digits.";
      }
    } else if (!applicationOptions || optionsState !== "ready") {
      clientErrors.promotion = "Promotion options are unavailable. Retry loading them before applying.";
    } else {
      const promotionValue = customPromotion ? promotion.trim() : promotion;
      const error = promotionError(promotionValue, applicationOptions.current_academic_year_start);
      if (error) clientErrors.promotion = error;
    }
    if (Object.keys(clientErrors).length) {
      setErrors({ fields: clientErrors });
      setMessage(null);
      return;
    }
    const isCurrent = captureScope();
    setLoading(true);
    setMessage(null);
    setErrors({ fields: {} });

    try {
      const payload = applicantType === "STUDENT" ? {
        applicant_type: applicantType,
        applicant_first_name: firstName.trim(),
        applicant_family_name: familyName.trim(),
        identifier_type: identifierType,
        cne: identifierType === "MASSAR" ? normalizedCne.toUpperCase() : normalizedCne,
      } : {
        applicant_type: applicantType,
        applicant_first_name: firstName.trim(),
        applicant_family_name: familyName.trim(),
        promotion: promotion.trim(),
      };
      await fetchApi("/api/v1/communities/irm/membership", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!isCurrent()) return;
      setMessage({ text: "Membership request submitted successfully.", type: "success" });
      setApplicantType(""); setFirstName(""); setFamilyName(""); setCne(""); setPromotion(""); setCustomPromotion(false);
      await refresh();
    } catch (err) {
      if (!isCurrent()) return;
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) void refresh();
      const formatted = formatFormError(err, "Failed to submit membership request.");
      if (formatted.fields.cne) formatted.fields.cne = "Use a valid student identifier in the format shown above.";
      setErrors(formatted);
      if (formatted.general) {
        setMessage({ text: formatted.general, type: "error" });
      }
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };

  return (
    <section id="community-membership" aria-labelledby="community-membership-heading" className={`${styles.membershipCard} space-y-6`}>
        <div>
          <h2 id="community-membership-heading" className="text-lg font-bold mb-1 text-text tracking-tight">Community membership</h2>
          <p className="text-sm text-text-muted">
            IRM at FST Mohammedia. Your submitted application details remain separate from your account profile.
          </p>
        </div>

        {message && (
          <FeedbackMessage type={message.type} message={message.text} />
        )}

        {!masked && !membershipError && !authError && membership && <div className="rounded-control border border-border bg-surface-secondary p-4 text-sm text-text-muted space-y-1">
          <p>Community: <span className="font-medium text-text">IRM · FST Mohammedia</span></p>
          <p>Status: <span className="font-medium text-text">{membership.status}</span></p>
          <p>Role: <span className="font-medium text-text">{membership.role}</span></p>
        </div>}
        {!masked && !membershipError && !authError && membership && membership.status !== "BANNED" && <OwnApplicationDetails membership={membership} />}

        {masked ? <p role="status" className="text-sm text-text-muted">Checking membership status…</p>
        : membershipError || authError ? <FeedbackMessage type="error" message="Membership status could not be verified." onRetry={refresh} retryLabel="Retry Verification" />
        : !user ? <AccessDeniedGuidance isGuest={true} returnHref="/account" returnLabel="Account" />
        : membership?.status === "BANNED" || (membership && !["ACTIVE", "PENDING", "REJECTED", "REMOVED"].includes(membership.status)) ? <AccessDeniedGuidance membershipStatus={membership.status} />
        : membership && (membership.status === "ACTIVE" || membership.status === "PENDING") ? (
          <div className="p-5 sm:p-6 bg-surface-secondary border border-border rounded-surface space-y-4">
            <h3 className="font-bold text-base text-text">Current membership</h3>

            {membership.status === "ACTIVE" && (
              <div className="mt-4 pt-4 border-t border-border space-y-4">
                <p className="text-xs sm:text-sm text-success bg-success-surface border border-success-border p-3 rounded-control leading-relaxed">
                  You are an active member. You can upload resources, preview pending student documents, and vote on community submissions.
                </p>
                <div className="flex flex-wrap gap-3 pt-1">
                  <Link
                    href="/communities/irm/modules"
                    className="ui-button ui-button--primary"
                  >
                    Explore Modules &rarr;
                  </Link>
                  <Link
                    href="/communities/irm/documents/pending"
                    className="inline-flex items-center justify-center bg-surface hover:bg-surface-secondary text-text border border-border font-medium px-4 py-2.5 rounded-control text-sm transition-colors min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    Pending Documents Review
                  </Link>
                </div>
              </div>
            )}

            {membership.status === "ACTIVE" && membership.role === "DELEGATE" && (
              <div className="mt-4 pt-4 border-t border-border space-y-2">
                <span className="text-xs font-bold text-text-muted uppercase tracking-wider block">Delegate Tools</span>
                <div className="flex flex-col sm:flex-row gap-3 pt-1">
                  <Link
                    href="/communities/irm/membership/review"
                    className="ui-button ui-button--secondary"
                  >
                    Review Pending Applications &rarr;
                  </Link>
                  <Link
                    href="/communities/irm/membership/staff"
                    className="ui-button ui-button--secondary"
                  >
                    Staff Management &rarr;
                  </Link>
                </div>
              </div>
            )}
            
            {membership.status === "PENDING" && (
              <div className="mt-4 pt-4 border-t border-border space-y-3">
                <p className="text-xs sm:text-sm text-warning bg-warning-surface border border-warning-border p-3 rounded-control leading-relaxed">
                  Your request is usually reviewed within approximately 6 hours. If you have not received an update after that, contact <Link className="underline font-semibold" href="/support">Support</Link>.
                </p>
                {!confirmCancel ? (
                  <button 
                    type="button"
                    onClick={() => setConfirmCancel(true)}
                    disabled={canceling} aria-busy={canceling}
                    className="ui-button ui-button--destructive"
                  >
                    Cancel pending request
                  </button>
                ) : (
                  <div className="bg-error-surface p-4 rounded-surface border border-error-border space-y-3">
                    <p className="text-sm text-error">
                      Are you sure? Canceling will withdraw this request. You may apply again later.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <button 
                        type="button"
                        onClick={handleCancelRequest}
                        disabled={canceling} aria-busy={canceling}
                        className="ui-button ui-button--destructive"
                      >
                        {canceling ? "Canceling..." : "Confirm Cancellation"}
                      </button>
                      <button 
                        type="button"
                        onClick={() => setConfirmCancel(false)}
                        disabled={canceling} aria-busy={canceling}
                        className="ui-button ui-button--secondary"
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
          <div className="space-y-4">
            {membership?.status === "REMOVED" && <FeedbackMessage type="info" message="Your IRM community membership has ended. Your account remains available. You may submit a fresh application below." />}
            {membership?.status === "REJECTED" && (
              <div className="p-4 bg-error-surface border border-error-border text-error rounded-surface text-sm leading-relaxed">
                Your previous membership request was REJECTED. You may reapply below with valid application details.
              </div>
            )}

            <p className="text-sm text-text-muted leading-relaxed">
              Submit the name and application details for this community. Your submitted name is separate from your account profile name and is not independently verified by this form.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div>
                <label className="block text-sm font-medium text-text mb-1" htmlFor="applicant_type">Applicant type</label>
                <select id="applicant_type" value={applicantType} disabled={loading} required aria-invalid={!!errors.fields.applicant_type} aria-describedby={errors.fields.applicant_type ? "applicant_type-error" : undefined} onChange={(e) => { setApplicantType(e.target.value as ApplicantType | ""); setErrors({ fields: {} }); }} className="w-full min-h-[44px] p-2.5 border rounded-control bg-surface border-border text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                  <option value="">Choose Student or Laureate</option>
                  {(applicationOptions?.applicant_types || ["STUDENT", "LAUREATE"]).map(type => <option key={type} value={type}>{type === "STUDENT" ? "Student" : "Laureate"}</option>)}
                </select>
                {errors.fields.applicant_type && <p id="applicant_type-error" className="text-xs text-error mt-1" role="alert">{errors.fields.applicant_type}</p>}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {([["applicant_first_name", "Real first name", firstName, setFirstName], ["applicant_family_name", "Real family name", familyName, setFamilyName]] as const).map(([id, label, value, setter]) => (
                  <div key={id}>
                    <label className="block text-sm font-medium text-text mb-1" htmlFor={id}>{label}</label>
                    <input id={id} name={id} type="text" autoComplete="off" maxLength={200} required={!!applicantType} value={value} disabled={loading} onChange={(event) => setter(event.target.value)} aria-invalid={!!errors.fields[id]} aria-describedby={errors.fields[id] ? `${id}-error` : undefined} className="w-full min-h-[44px] p-2.5 border rounded-control bg-surface border-border text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-focus" />
                    {errors.fields[id] && <p id={`${id}-error`} className="text-xs text-error mt-1" role="alert">{errors.fields[id]}</p>}
                  </div>
                ))}
              </div>
              {applicantType === "STUDENT" && <div className="space-y-3 rounded-control border border-border p-4">
                <div>
                  <label className="block text-sm font-medium text-text mb-1" htmlFor="identifier_type">Student identifier type</label>
                  <select id="identifier_type" value={identifierType} required disabled={loading} aria-invalid={!!errors.fields.identifier_type} aria-describedby={errors.fields.identifier_type ? "identifier_type-error" : undefined} onChange={e => setIdentifierType(e.target.value as IdentifierType)} className="w-full min-h-[44px] p-2.5 border rounded-control bg-surface border-border text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                    {(applicationOptions?.student_identifier_types || ["MASSAR", "FOREIGN"]).map(type => <option key={type} value={type}>{type === "MASSAR" ? "Code Massar" : "Foreign student identifier"}</option>)}
                  </select>
                  {errors.fields.identifier_type && <p id="identifier_type-error" className="text-xs text-error mt-1" role="alert">{errors.fields.identifier_type}</p>}
                  <p className="mt-1 text-xs text-text-muted">{identifierType === "MASSAR" ? "One ASCII letter followed by nine digits (for example, R123456789)." : "Use 1–50 ASCII letters or digits. Numeric identifiers and leading zeros are supported; no country-specific passport format is assumed."} Entering an identifier does not verify identity or document authenticity.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-text mb-1" htmlFor="cne">Student identifier</label>
                  <input id="cne" name="cne" type="text" autoComplete="off" maxLength={60} required disabled={loading} value={cne} onChange={e => setCne(e.target.value)} aria-invalid={!!errors.fields.cne} aria-describedby={errors.fields.cne ? "cne-error" : "identifier-help"} className="w-full min-h-[44px] p-2.5 border rounded-control bg-surface border-border text-text font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-focus" />
                  <span id="identifier-help" className="sr-only">Leading zeros are preserved.</span>
                  {errors.fields.cne && <p id="cne-error" className="text-xs text-error mt-1" role="alert">{errors.fields.cne}</p>}
                </div>
              </div>}
              {applicantType === "LAUREATE" && <div className="space-y-3 rounded-control border border-border p-4">
                <p className="text-sm text-text-muted">Choose a completed promotion, or enter an older/custom graduation year.</p>
                {optionsState === "loading" ? <p role="status" className="text-sm text-text-muted">Loading completed promotion options…</p>
                  : optionsState === "error" || !applicationOptions ? <div role="alert" className="space-y-2 text-sm text-error"><p>Promotion options could not be loaded. Laureate applications are unavailable until these options load.</p><button type="button" className="ui-button ui-button--secondary" onClick={() => { const isCurrent = captureScope(); setOptionsState("loading"); fetchApi<ApplicationOptions>("/api/v1/communities/irm/membership/application-options").then(value => { if (isCurrent()) { setApplicationOptions(value); setOptionsState(value.promotion_options.length ? "ready" : "error"); } }).catch(() => { if (isCurrent()) setOptionsState("error"); }); }}>Retry options</button></div>
                  : <>
                    <label className="block text-sm font-medium text-text" htmlFor="promotion_option">Completed promotion</label>
                    <select id="promotion_option" value={customPromotion ? "" : promotion} onChange={e => { setPromotion(e.target.value); setCustomPromotion(false); }} disabled={loading} className="w-full min-h-[44px] p-2.5 border rounded-control bg-surface border-border text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"><option value="">Choose a promotion</option>{applicationOptions.promotion_options.map(option => <option key={option} value={option}>{option}</option>)}</select>
                    <button type="button" className="ui-button ui-button--secondary" onClick={() => { setCustomPromotion(true); setPromotion(""); }}>Older / Other</button>
                    {customPromotion && <div><label className="block text-sm font-medium text-text mb-1" htmlFor="promotion">Custom promotion</label><input id="promotion" name="promotion" type="text" autoComplete="off" maxLength={20} required disabled={loading} value={promotion} onChange={e => setPromotion(e.target.value)} placeholder={applicationOptions.custom_promotion_formats.join(", ")} aria-invalid={!!errors.fields.promotion} aria-describedby={errors.fields.promotion ? "promotion-error" : "promotion-help"} className="w-full min-h-[44px] p-2.5 border rounded-control bg-surface border-border text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"/><p id="promotion-help" className="mt-1 text-xs text-text-muted">Use ASCII digits in {applicationOptions.custom_promotion_formats.join(", ")}. Year pairs must be consecutive; two-digit years mean 20YY.</p></div>}
                  </>}
                {errors.fields.promotion && <p id="promotion-error" className="text-xs text-error mt-1" role="alert">{errors.fields.promotion}</p>}
              </div>}
              {errors.general && !message && <FeedbackMessage type="error" message={errors.general} />}

              <button
                type="submit"
                aria-busy={loading}
                disabled={loading || !applicantType || (applicantType === "STUDENT" && !cne.trim()) || (applicantType === "LAUREATE" && (optionsState !== "ready" || !applicationOptions || (!customPromotion && !promotion)))}
                className="ui-button ui-button--primary"
              >
                {loading ? "Submitting..." : ((membership?.status === "REJECTED" || membership?.status === "REMOVED") ? "Reapply for membership" : "Request membership")}
              </button>
            </form>
          </div>
        )}
    </section>
  );
}

function OwnApplicationDetails({ membership }: { membership: NonNullable<ReturnType<typeof useAuth>["membership"]> }) {
  return <section aria-label="Your submitted application details" className="mb-6 p-5 bg-surface-secondary border border-border rounded-surface space-y-2 text-sm text-text-muted">
    <h3 className="font-semibold text-text">Submitted application details</h3>
    {membership.applicant_type ? <>
      <p>Applicant type: <span className="font-medium text-text">{membership.applicant_type}</span></p>
      <p>Submitted name: <span className="font-medium text-text">{membership.applicant_first_name || "Unavailable"} {membership.applicant_family_name || "Unavailable"}</span></p>
      {membership.applicant_type === "STUDENT" && <p>Student identifier{membership.identifier_type ? ` (${membership.identifier_type})` : ""}: <span className="font-mono text-text">{membership.cne || "Unavailable"}</span></p>}
      {membership.applicant_type === "LAUREATE" && <p>Promotion: <span className="font-medium text-text">{membership.promotion || "Unavailable"}</span></p>}
    </> : <p>Application details are unavailable for this membership.</p>}
  </section>;
}
