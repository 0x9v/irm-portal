"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchApi, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

export type ModuleResponse = {
  id: string;
  community_id: string;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
};

export default function ModulesPage() {
  const { membership, capabilities } = useAuth();
  const isActiveMember = membership?.status === "ACTIVE";
  const [modules, setModules] = useState<ModuleResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadModules() {
      try {
        const data = await fetchApi<ModuleResponse[]>("/api/v1/communities/irm/modules");
        setModules(data);
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.status === 401) {
            setError("Unauthorized. Please log in to view modules.");
          } else {
            setError(`Failed to load modules: ${err.message}`);
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

    loadModules();
  }, []);

  return (
    <div className="p-4 sm:p-8 font-sans max-w-4xl mx-auto mt-6 sm:mt-10">
      <div className="mb-4 text-sm">
        <Link href="/" className="text-gray-500 hover:text-gray-900 hover:underline inline-flex items-center gap-1">
          &larr; Back to IRM Hub
        </Link>
      </div>

      <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">IRM Modules</h1>
          <p className="text-sm text-gray-500 mt-1">Browse study resources organized by course module.</p>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href="/communities/irm/membership" className="text-blue-600 hover:underline font-medium">
            Membership
          </Link>
          <Link href="/communities/irm/announcements" className="text-blue-600 hover:underline font-medium">
            Announcements
          </Link>
          {isActiveMember && (
            <Link href="/communities/irm/documents/pending" className="text-blue-600 hover:underline font-medium">
              Pending Docs
            </Link>
          )}
          {capabilities?.manage_document_voting && (
            <Link href="/communities/irm/document-voting/settings" className="text-blue-600 hover:underline font-medium">
              Voting Settings
            </Link>
          )}
        </div>
      </div>
      
      {loading ? (
        <div className="text-gray-600">Loading modules...</div>
      ) : error ? (
        <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded">
          {error}
        </div>
      ) : modules.length === 0 ? (
        <div className="text-gray-600">No modules found.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {modules.map((mod) => (
            <div key={mod.id} className="p-4 border border-gray-200 rounded-lg shadow-sm bg-white hover:shadow-md transition-shadow">
              <h2 className="text-lg font-semibold mb-2">{mod.name}</h2>
              <Link 
                href={`/communities/irm/modules/${mod.slug}`} 
                className="text-blue-600 hover:underline text-sm font-medium"
              >
                Open Module &rarr;
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
