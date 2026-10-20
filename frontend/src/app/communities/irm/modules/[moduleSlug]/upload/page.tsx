"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { fetchApi, ApiError } from "@/lib/api";
import { useAuth, type SelfMembershipInfo } from "@/context/AuthContext";
import type { ModuleResponse } from "@/components/modules/ModuleBrowserFrame";
import AccessDeniedGuidance from "@/components/AccessDeniedGuidance";
import PageContainer from "@/components/PageContainer";
import Breadcrumbs from "@/components/Breadcrumbs";
import FeedbackMessage from "@/components/FeedbackMessage";
import { buttonStyles } from "@/components/ui/Button";
import {
  draftError, fileError, submissionBody, validCreation, type ResourceCreated,
  type ResourceDraft, type ResourceKind, type ResourceSource,
} from "@/lib/moduleResourceSubmission";
import { DOCUMENT_CATEGORY_OPTIONS, documentTypeLabel, type DocumentTypeValue } from "@/lib/documentPresentation";

const KINDS: { value: ResourceKind; label: string }[] = [
  { value: "PDF", label: "PDF" }, { value: "IMAGE", label: "Image" },
  { value: "YOUTUBE", label: "YouTube" }, { value: "LINK", label: "Lien" },
];

function emptyDraft(): ResourceDraft {
  return { kind: "PDF", title: "", description: "", source: "STUDENT", category: "", file: null, url: "" };
}

function ResourceForm({ moduleSlug, mod, membership, officialAllowed }: {
  moduleSlug: string; mod: ModuleResponse; membership: SelfMembershipInfo; officialAllowed: boolean;
}) {
  const [draft, setDraft] = useState<ResourceDraft>(emptyDraft);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "error" | "warning"; message: string } | null>(null);
  const [created, setCreated] = useState<ResourceCreated | null>(null);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const operationRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<string | null>(null);

  useEffect(() => () => {
    controllerRef.current?.abort();
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  function changePreview(file: File | null) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const next = file ? URL.createObjectURL(file) : null;
    previewRef.current = next;
    setPreviewUrl(next);
  }

  function selectKind(kind: ResourceKind) {
    if (operationRef.current || uncertain) return;
    changePreview(null);
    if (inputRef.current) inputRef.current.value = "";
    setDraft(current => ({ ...current, kind, file: null, url: "" }));
    setFeedback(null);
  }

  function selectFile(file: File | null) {
    if (operationRef.current || uncertain || (draft.kind !== "PDF" && draft.kind !== "IMAGE")) return;
    const error = file ? fileError(draft.kind, file) : null;
    changePreview(error || draft.kind !== "IMAGE" ? null : file);
    setDraft(current => ({ ...current, file: error ? null : file }));
    setFeedback(error ? { type: "error", message: error } : null);
    if (error && inputRef.current) inputRef.current.value = "";
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (operationRef.current || uncertain) return;
    const error = draftError(draft);
    if (error) { setFeedback({ type: "error", message: error }); return; }
    if (draft.source === "OFFICIAL" && !officialAllowed) {
      setFeedback({ type: "error", message: "Official submission is unavailable for this account." });
      return;
    }
    operationRef.current = true;
    const controller = new AbortController();
    controllerRef.current = controller;
    setPending(true);
    setFeedback(null);
    const submitted = { ...draft };
    try {
      const result = await fetchApi<ResourceCreated>(
        `/api/v1/communities/irm/modules/${encodeURIComponent(moduleSlug)}/resources`,
        { method: "POST", body: submissionBody(submitted), signal: controller.signal }, 201,
      );
      if (!validCreation(result, submitted, mod.id, membership.role)) throw new Error("Unverified creation response");
      if (controller.signal.aborted) return;
      setCreated(result);
      changePreview(null);
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (cause instanceof ApiError && cause.status < 500) {
        const message = cause.status === 401 || cause.status === 403
          ? "Your account cannot submit this resource. Check your access and try again."
          : cause.status === 413 ? "The resource is too large. Check the file size."
          : cause.status === 415 ? "The selected file or request format is unsupported."
          : cause.status === 422 ? "The resource details were rejected. Check the fields and URL."
          : "The resource could not be submitted. Check the details before trying again.";
        setFeedback({ type: "error", message });
      } else {
        setUncertain(true);
        setFeedback({ type: "warning", message: "Creation could not be confirmed. Your draft is kept here. Check your submissions before starting a new attempt; resending could create a duplicate." });
      }
    } finally {
      if (!controller.signal.aborted) { operationRef.current = false; setPending(false); }
    }
  }

  function reset() {
    if (operationRef.current) return;
    changePreview(null);
    if (inputRef.current) inputRef.current.value = "";
    setDraft(emptyDraft());
    setCreated(null);
    setFeedback(null);
    setUncertain(false);
  }

  const locked = pending || uncertain;
  const sourceOptions: ResourceSource[] = officialAllowed ? ["STUDENT", "OFFICIAL"] : ["STUDENT"];
  const showSource = membership.role === "DELEGATE" || membership.role === "MODERATOR";

  return <PageContainer width="default">
    <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Modules", href: "/communities/irm/modules" },
      { label: mod.name, href: `/communities/irm/modules/${moduleSlug}` }, { label: "Upload" }]} />
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0"><p className="ui-eyebrow">IRM / Study resources</p>
        <h1 className="ui-page-heading text-text">Submit a resource</h1>
        <p className="ui-helper break-words">Module: {mod.name}</p></div>
      <Link href={`/communities/irm/modules/${moduleSlug}`} className={buttonStyles("quiet")}>← Back to {mod.name}</Link>
    </div>
    {created ? <div className="ui-surface space-y-4">
      <FeedbackMessage type="success" message={created.status === "PENDING"
        ? "Resource submitted for community review and voting. It is not published yet."
        : created.source === "STUDENT" ? "Student resource published." : "Official resource published."} />
      <p className="text-sm text-text">{created.title}</p>
      <p className="text-sm text-text-subtle">Source: {created.source === "STUDENT" ? "Student" : "Official"}</p>
      <p className="text-sm text-text-subtle">Catégorie: {documentTypeLabel(created.category)}</p>
      <button type="button" className={buttonStyles("secondary", "min-h-[44px]")} onClick={reset}>Submit another resource</button>
    </div> : <form onSubmit={submit} className="ui-surface space-y-6 min-w-0" aria-busy={pending}>
      <div className="rounded-control border border-border bg-surface-secondary p-4 text-sm text-text">
        {draft.source === "STUDENT" ? membership.role === "DELEGATE"
          ? "As the current Delegate, this student resource publishes immediately after confirmation and remains a student resource."
          : "Student submissions enter community review and voting. Your resource is not published until approved, and you cannot vote on your own submission."
          : "Official submissions publish immediately after confirmation."}
      </div>
      {feedback && <FeedbackMessage type={feedback.type} message={feedback.message} />}
      {uncertain && <button type="button" className={buttonStyles("secondary", "min-h-[44px]")} onClick={() => setUncertain(false)}>
        Edit draft for a new attempt
      </button>}
      <div><label className="ui-label" htmlFor="resource-category">Catégorie</label>
        <select id="resource-category" className="ui-field min-h-[44px]" value={draft.category} required disabled={locked}
          onChange={event => setDraft(current => ({ ...current, category: event.target.value as DocumentTypeValue | "" }))}>
          <option value="">Choisir une catégorie</option>
          {DOCUMENT_CATEGORY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></div>
      <div><label className="ui-label" htmlFor="resource-kind">Format</label>
        <select id="resource-kind" className="ui-field min-h-[44px]" value={draft.kind} disabled={locked}
          onChange={event => selectKind(event.target.value as ResourceKind)}>
          {KINDS.map(kind => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
        </select></div>
      {showSource && <div><label className="ui-label" htmlFor="resource-source">Submit as</label>
        <select id="resource-source" className="ui-field min-h-[44px]" value={draft.source} disabled={locked}
          onChange={event => setDraft(current => ({ ...current, source: event.target.value as ResourceSource }))}>
          {sourceOptions.map(source => <option key={source} value={source}>{source === "STUDENT"
            ? membership.role === "DELEGATE" ? "Student contribution (publish immediately)" : "Student contribution (review and voting)"
            : "Official (publish immediately)"}</option>)}
        </select></div>}
      <div><label className="ui-label" htmlFor="resource-title">Title</label>
        <input id="resource-title" className="ui-field min-h-[44px]" required maxLength={255} value={draft.title} disabled={locked}
          onChange={event => setDraft(current => ({ ...current, title: event.target.value }))} /></div>
      <div><label className="ui-label" htmlFor="resource-description">Description <span className="text-text-subtle">(optional)</span></label>
        <textarea id="resource-description" className="ui-field min-h-[88px]" maxLength={2000} value={draft.description} disabled={locked}
          onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} /></div>
      {(draft.kind === "PDF" || draft.kind === "IMAGE") && <div className="min-w-0">
        <label className="ui-label" htmlFor="resource-file">{draft.kind === "PDF" ? "PDF file" : "Image file"}</label>
        <input key={draft.kind} id="resource-file" ref={inputRef} type="file" required className="ui-field min-h-[44px] max-w-full"
          accept={draft.kind === "PDF" ? ".pdf,application/pdf" : ".jpg,.jpeg,.png,image/jpeg,image/png"}
          disabled={locked} onChange={event => selectFile(event.target.files?.[0] ?? null)} />
        <p className="ui-helper mt-1">{draft.kind === "PDF" ? "PDF, up to 50 MiB." : "One JPEG or PNG image, up to 10 MiB. The server will create a safe static image."}</p>
        {draft.file && <div className="mt-3 min-w-0 space-y-2"><p className="break-all text-sm text-text">Selected: {draft.file.name}</p>
          {draft.kind === "IMAGE" && previewUrl && <figure className="max-w-full rounded-control border border-border bg-surface-secondary p-2">
            {/* Local object URL is created only for the selected unsaved file. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="Unsaved selected image preview" className="block h-auto max-h-80 max-w-full object-contain" />
            <figcaption className="ui-helper mt-1">Unsaved preview on this device</figcaption>
          </figure>}
          <button type="button" className={buttonStyles("secondary", "min-h-[44px]")} disabled={locked}
            onClick={() => { selectFile(null); if (inputRef.current) inputRef.current.value = ""; }}>Remove selected file</button>
        </div>}
      </div>}
      {(draft.kind === "YOUTUBE" || draft.kind === "LINK") && <div>
        <label className="ui-label" htmlFor="resource-url">{draft.kind === "YOUTUBE" ? "YouTube video URL" : "Useful link URL"}</label>
        <input id="resource-url" type="url" className="ui-field min-h-[44px]" required maxLength={2048} value={draft.url} disabled={locked}
          placeholder={draft.kind === "YOUTUBE" ? "https://www.youtube.com/watch?v=..." : "https://example.org/resource"}
          onChange={event => setDraft(current => ({ ...current, url: event.target.value }))} />
        <p className="ui-helper mt-1">{draft.kind === "YOUTUBE" ? "Use an HTTPS watch, shorts, or youtu.be video URL." : "Use a direct HTTPS link. No preview is fetched."}</p>
      </div>}
      <button type="submit" disabled={locked} aria-busy={pending} className={buttonStyles("primary", "w-full min-h-[44px]")}>
        {pending ? "Submitting..." : "Submit resource"}
      </button>
    </form>}
  </PageContainer>;
}

export default function UploadDocumentPage() {
  const params = useParams();
  const moduleSlug = params.moduleSlug as string;
  const { user, membership, capabilities, isLoading: authLoading } = useAuth();
  const [mod, setMod] = useState<ModuleResponse | null>(null);
  const [loadedScope, setLoadedScope] = useState("");
  const [moduleError, setModuleError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const scope = `${user?.id ?? ""}:irm:${membership?.id ?? ""}:${moduleSlug}`;

  useEffect(() => {
    if (authLoading || !user || membership?.status !== "ACTIVE") return;
    const controller = new AbortController();
    fetchApi<ModuleResponse>(`/api/v1/communities/irm/modules/${encodeURIComponent(moduleSlug)}`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) { setMod(data); setLoadedScope(scope); setModuleError(null); } })
      .catch(error => { if (!controller.signal.aborted) setModuleError(error instanceof ApiError && error.status === 404 ? "Module not found." : "Module could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [moduleSlug, authLoading, user, membership, scope]);

  if (authLoading) return <PageContainer width="default"><p role="status" className="ui-helper py-12">Loading account...</p></PageContainer>;
  if (!user) return <PageContainer width="default"><AccessDeniedGuidance isGuest returnHref={`/communities/irm/modules/${moduleSlug}`} returnLabel="Module" /></PageContainer>;
  if (!membership || membership.status !== "ACTIVE") return <PageContainer width="default"><AccessDeniedGuidance membershipStatus={membership?.status} returnHref={`/communities/irm/modules/${moduleSlug}`} returnLabel="Module" /></PageContainer>;
  if (moduleError) return <PageContainer width="default"><AccessDeniedGuidance isNotFound notFoundMessage={moduleError} returnHref="/communities/irm/modules" returnLabel="Modules" /></PageContainer>;
  if (loading || !mod || loadedScope !== scope) return <PageContainer width="default"><p role="status" className="ui-helper py-12">Loading module...</p></PageContainer>;
  return <ResourceForm key={scope} moduleSlug={moduleSlug} mod={mod} membership={membership}
    officialAllowed={Boolean(capabilities?.upload_official_documents)} />;
}
