"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { fetchApi, downloadApiFile, ApiError } from "@/lib/api";
import { DocumentResponse } from "../../page";
import AccessDeniedGuidance from "@/components/AccessDeniedGuidance";

export default function DocumentDetailPage() {
  const params = useParams();
  const moduleSlug = params.moduleSlug as string;
  const documentId = params.documentId as string;

  const [doc, setDoc] = useState<DocumentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    async function loadDocument() {
      if (!moduleSlug || !documentId) return;
      
      try {
        const data = await fetchApi<DocumentResponse>(
          `/api/v1/communities/irm/modules/${moduleSlug}/documents/${documentId}`
        );
        setDoc(data);
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.status === 401) {
            setError("Unauthorized. Please log in to view this document.");
          } else if (err.status === 404) {
            setError("Document not found.");
          } else {
            setError(`Failed to load document: ${err.message}`);
          }
        } else if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("An unexpected error occurred.");
        }
      } finally {
        setLoading(false);
      }
    }

    loadDocument();
  }, [moduleSlug, documentId]);

  const handleDownload = async () => {
    if (!doc) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      // The API uses the filename as the download name if we can't extract it from headers,
      // but here we just use the title as the download filename.
      // Usually the backend Content-Disposition header provides the real filename,
      // but the HTML5 download attribute can set a fallback.
      await downloadApiFile(
        `/api/v1/communities/irm/modules/${moduleSlug}/documents/${documentId}/download`,
        doc.title
      );
    } catch (err) {
      if (err instanceof Error) {
        setDownloadError(`Download failed: ${err.message}`);
      } else {
        setDownloadError("Download failed due to an unexpected error.");
      }
    } finally {
      setDownloading(false);
    }
  };

  return (
    <main className="p-4 sm:p-8 font-sans max-w-2xl mx-auto mt-6 sm:mt-10">
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
        <Link href={`/communities/irm/modules/${moduleSlug}`} className="hover:text-gray-900 hover:underline">
          {moduleSlug}
        </Link>
        {doc && (
          <>
            <span>/</span>
            <span className="text-gray-900 font-medium truncate max-w-xs">{doc.title}</span>
          </>
        )}
      </nav>

      <div className="mb-6 flex flex-wrap justify-between items-center gap-2">
        <Link 
          href={`/communities/irm/modules/${moduleSlug}`} 
          className="text-gray-500 hover:text-gray-900 hover:underline text-sm inline-block"
        >
          &larr; Back to Module
        </Link>
        <Link
          href="/communities/irm/modules"
          className="text-gray-400 hover:text-gray-700 hover:underline text-xs"
        >
          All Modules
        </Link>
      </div>

      {loading ? (
        <div className="text-gray-500 py-8">Loading document details...</div>
      ) : error ? (
        <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-lg">
          {error}
        </div>
      ) : !doc ? (
        <AccessDeniedGuidance
          isNotFound={true}
          notFoundMessage="Document not found. It may have been removed or rejected."
          returnHref={`/communities/irm/modules/${moduleSlug}`}
          returnLabel="Module"
        />
      ) : (
        <div className="p-6 sm:p-8 bg-white border border-gray-200 rounded-xl shadow-sm">
          <h1 className="text-2xl font-bold mb-4 text-gray-900">{doc.title}</h1>
          
          <div className="space-y-3 mb-8">
            <p className="text-sm text-gray-700">
              <span className="font-semibold w-24 inline-block">Type:</span> {doc.type}
            </p>
            <p className="text-sm text-gray-700">
              <span className="font-semibold w-24 inline-block">Source:</span> {doc.source}
            </p>
            <p className="text-sm text-gray-700">
              <span className="font-semibold w-24 inline-block">Added on:</span>{" "}
              {new Date(doc.created_at).toLocaleDateString()}
            </p>
          </div>
          
          {downloadError && (
            <div className="mb-4 p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded">
              {downloadError}
            </div>
          )}

          <button
            onClick={handleDownload}
            disabled={downloading}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-6 rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {downloading ? "Downloading..." : "Download"}
          </button>
        </div>
      )}
    </main>
  );
}
