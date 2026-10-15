"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { fetchApi, downloadApiFile, ApiError } from "@/lib/api";
import { DocumentResponse } from "../../page";
import { ModuleResponse } from "../../../page";
import AccessDeniedGuidance from "@/components/AccessDeniedGuidance";
import PageContainer from "@/components/PageContainer";
import Breadcrumbs from "@/components/Breadcrumbs";
import FeedbackMessage from "@/components/FeedbackMessage";
import { buttonStyles } from "@/components/ui/Button";
import {
  documentSourceLabel,
  documentTypeLabel,
  isDocumentReturnContext,
  moduleDocumentHref,
  readModuleDocumentFilters,
  type DocumentReturnContext,
} from "@/lib/documentPresentation";

import DocumentReader from "@/components/DocumentReader";
import SavedDocumentButton from "@/components/SavedDocumentButton";
import { useAuth } from "@/context/AuthContext";

export default function DocumentDetailPage() {
  const { user } = useAuth();
  const params = useParams();
  const moduleSlug = params.moduleSlug as string;
  const documentId = params.documentId as string;

  const [doc, setDoc] = useState<DocumentResponse | null>(null);
  const [mod, setMod] = useState<ModuleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [returnContext, setReturnContext] = useState<DocumentReturnContext>("module");
  const [returnHref, setReturnHref] = useState(`/communities/irm/modules/${encodeURIComponent(moduleSlug)}`);
  const [returnLabel, setReturnLabel] = useState("Back to module");
  const [moduleHref, setModuleHref] = useState(`/communities/irm/modules/${encodeURIComponent(moduleSlug)}`);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rawContext = params.get("from");
    const context = isDocumentReturnContext(rawContext) ? rawContext : "module";
    // URL -> navigation state synchronization; the context is allowlisted above.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReturnContext(context);
    if (context === "mine") {
      setReturnHref("/communities/irm/documents/mine");
      setReturnLabel("Back to My Submissions");
    } else if (context === "pending") {
      setReturnHref("/communities/irm/documents/pending");
      setReturnLabel("Back to Pending Documents");
    } else {
      const href = moduleDocumentHref(moduleSlug, readModuleDocumentFilters(window.location.search), "module",
        params.get("kind") === "PDF" ? "PDF" : undefined);
      setReturnHref(href);
      setModuleHref(href);
      setReturnLabel("Back to module documents");
    }
  }, [moduleSlug]);

  const loadDocument = useCallback(async () => {
    if (!moduleSlug || !documentId) return;
    setLoading(true);
    setError(null);
    try {
      // Fetch document and module info in parallel for safe, user-friendly labels
      const [docData, modData] = await Promise.all([
        fetchApi<DocumentResponse>(`/api/v1/communities/irm/modules/${moduleSlug}/documents/${documentId}`),
        fetchApi<ModuleResponse>(`/api/v1/communities/irm/modules/${moduleSlug}`).catch(() => null),
      ]);
      setDoc(docData);
      if (modData) setMod(modData);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setError("Unauthorized. Please log in to view this document.");
        } else if (err.status === 404) {
          setError("Document not found.");
        } else {
          setError("Document could not be loaded. Please try again.");
        }
      } else if (err instanceof Error) {
        setError("Document could not be loaded. Please try again.");
      } else {
        setError("An unexpected error occurred.");
      }
    } finally {
      setLoading(false);
    }
  }, [moduleSlug, documentId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDocument();
  }, [loadDocument]);

  const handleDownload = async () => {
    if (!doc) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadApiFile(
        `/api/v1/communities/irm/modules/${moduleSlug}/documents/${documentId}/download`,
        doc.title
      );
    } catch {
      setDownloadError("Download could not be completed. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  const moduleLabel = mod ? mod.name : "Module";

  return (
    <PageContainer width="reader">
      {/* Breadcrumb Navigation */}
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          ...(returnContext === "mine"
            ? [{ label: "My Submissions", href: "/communities/irm/documents/mine" }]
            : returnContext === "pending"
              ? [{ label: "Pending Documents", href: "/communities/irm/documents/pending" }]
              : [
                  { label: "Modules", href: "/communities/irm/modules" },
                  { label: moduleLabel, href: moduleHref },
                ]),
          { label: doc ? doc.title : "Document" },
        ]}
      />

      <div className="mb-6">
        <Link href={returnHref} className={buttonStyles("quiet")}>
          &larr; {returnLabel}
        </Link>
      </div>

      {loading ? (
        <div className="py-12 text-center text-text-muted text-sm" role="status">Loading document details...</div>
      ) : error && error !== "Document not found." ? (
        <div className="my-4">
          <FeedbackMessage
            type="error"
            message={error}
            onRetry={loadDocument}
            retryLabel="Retry Loading"
          />
        </div>
      ) : !doc ? (
        <AccessDeniedGuidance
          isNotFound={true}
          notFoundMessage="Document not found. It may have been removed or rejected."
          returnHref={`/communities/irm/modules/${moduleSlug}`}
          returnLabel={moduleLabel}
        />
      ) : (
        <div className="ui-surface ui-reader-surface space-y-6">
          <div>
            <p className="ui-eyebrow">IRM / Study resources</p>
          <h1 className="ui-page-heading text-text break-words">{doc.title}</h1>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-2 pt-2 border-t border-border text-xs sm:text-sm text-text-subtle">
              {returnContext !== "module" && (
                <p>
                  <span className="font-semibold text-text">Module:</span>{" "}
                  <Link href={moduleDocumentHref(moduleSlug)} className="ui-link">{moduleLabel}</Link>
                </p>
              )}
              <p>
                <span className="font-semibold text-text">Type:</span> {documentTypeLabel(doc.type)}
              </p>
              <p>
                <span className="font-semibold text-text">Source:</span> {documentSourceLabel(doc.source)}
              </p>
              <p>
                <span className="font-semibold text-text">Added:</span>{" "}
                {new Date(doc.created_at).toLocaleDateString()}
              </p>
              <SavedDocumentButton documentId={doc.id} />
            </div>
          </div>
          
          {downloadError && (
            <FeedbackMessage type="error" message={downloadError} />
          )}

          {/* Embedded Document Reader */}
          <div className="pt-2 border-t border-border">
            <DocumentReader
              key={`${doc.id}:${user?.id ?? "guest"}`}
              documentId={doc.id}
              documentTitle={doc.title}
              approved={doc.status === "APPROVED"}
              onDownload={handleDownload}
              downloading={downloading}
            />
          </div>
        </div>
      )}
    </PageContainer>
  );
}
