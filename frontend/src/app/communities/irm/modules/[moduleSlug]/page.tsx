"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { fetchApi, ApiError } from "@/lib/api";
import { ModuleResponse } from "../page";
import { useAuth } from "@/context/AuthContext";
import AccessDeniedGuidance from "@/components/AccessDeniedGuidance";

export type DocumentResponse = {
  id: string;
  title: string;
  module_id: string;
  uploader_id: string;
  type: string;
  source: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export default function ModuleDetailPage() {
  const params = useParams();
  const moduleSlug = params.moduleSlug as string;
  const { membership } = useAuth();

  const [mod, setMod] = useState<ModuleResponse | null>(null);
  const [documents, setDocuments] = useState<DocumentResponse[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadModuleAndDocs() {
      if (!moduleSlug) return;
      
      try {
        const modData = await fetchApi<ModuleResponse>(`/api/v1/communities/irm/modules/${moduleSlug}`);
        setMod(modData);

        const docsData = await fetchApi<DocumentResponse[]>(`/api/v1/communities/irm/modules/${moduleSlug}/documents`);
        setDocuments(docsData);
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.status === 401) {
            setError("Unauthorized. Please log in to view this module.");
          } else if (err.status === 404) {
            setError("Module not found.");
          } else {
            setError(`Failed to load module: ${err.message}`);
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

    loadModuleAndDocs();
  }, [moduleSlug]);

  const isActiveMember = membership?.status === "ACTIVE";

  return (
    <div className="p-4 sm:p-8 font-sans max-w-4xl mx-auto mt-6 sm:mt-10">
      {/* Breadcrumb Navigation */}
      <nav className="mb-4 text-sm flex flex-wrap items-center gap-1.5 text-gray-500" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-gray-900 hover:underline">
          IRM Hub
        </Link>
        <span>/</span>
        <Link href="/communities/irm/modules" className="hover:text-gray-900 hover:underline">
          Modules
        </Link>
        {mod && (
          <>
            <span>/</span>
            <span className="text-gray-900 font-medium">{mod.name}</span>
          </>
        )}
      </nav>

      <div className="mb-6 flex flex-wrap justify-between items-center gap-4">
        <Link href="/communities/irm/modules" className="text-gray-500 hover:text-gray-900 hover:underline text-sm inline-block">
          &larr; Back to Modules
        </Link>
        {isActiveMember && mod ? (
          <Link href={`/communities/irm/modules/${mod.slug}/upload`} className="text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-sm font-medium shadow-sm transition-colors">
            Upload Document
          </Link>
        ) : mod ? (
          <Link href="/communities/irm/membership" className="text-xs text-blue-600 hover:underline bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-lg">
            Active membership required to upload
          </Link>
        ) : null}
      </div>

      {loading ? (
        <div className="text-gray-500 py-8">Loading module details...</div>
      ) : error ? (
        <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-lg">
          {error}
        </div>
      ) : !mod ? (
        <AccessDeniedGuidance
          isNotFound={true}
          notFoundMessage="Module not found. It may have been removed or renamed."
          returnHref="/communities/irm/modules"
          returnLabel="Modules"
        />
      ) : (
        <div>
          <div className="mb-8 p-6 bg-white border border-gray-200 rounded-xl shadow-sm">
            <h1 className="text-2xl font-bold mb-2 text-gray-900">{mod.name}</h1>
            <p className="text-sm text-gray-500">Module code: <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded">{mod.slug}</span></p>
          </div>

          <h2 className="text-xl font-bold mb-4">Approved Documents</h2>
          
          {documents.length === 0 ? (
            <div className="text-gray-600">No documents found.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {documents.map((doc) => (
                <div key={doc.id} className="p-4 border border-gray-200 rounded-lg shadow-sm bg-white hover:shadow-md transition-shadow">
                  <h3 className="text-md font-semibold mb-2 truncate" title={doc.title}>{doc.title}</h3>
                  <p className="text-sm text-gray-600 mb-1">
                    <span className="font-medium">Type:</span> {doc.type}
                  </p>
                  <p className="text-sm text-gray-600 mb-3">
                    <span className="font-medium">Source:</span> {doc.source}
                  </p>
                  <Link 
                    href={`/communities/irm/modules/${mod.slug}/documents/${doc.id}`} 
                    className="text-blue-600 hover:underline text-sm font-medium"
                  >
                    View Details &rarr;
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
