"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { fetchApi, downloadApiFile, ApiError } from "@/lib/api";
import { DocumentResponse } from "../../page";

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
    <main className="p-8 font-sans max-w-2xl mx-auto mt-10">
      <div className="mb-6">
        <Link 
          href={`/communities/irm/modules/${moduleSlug}`} 
          className="text-gray-500 hover:underline text-sm mb-2 inline-block"
        >
          &larr; Back to Module
        </Link>
      </div>

      {loading ? (
        <div className="text-gray-600">Loading document...</div>
      ) : error ? (
        <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded">
          {error}
        </div>
      ) : !doc ? (
        <div className="text-gray-600">Document not found.</div>
      ) : (
        <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm">
          <h1 className="text-2xl font-bold mb-4">{doc.title}</h1>
          
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
