"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { fetchApi, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { ModuleResponse } from "../../page";
import { DocumentResponse } from "../page";

const DOCUMENT_TYPES = [
  { value: "COURSE", label: "Course" },
  { value: "TD", label: "TD (Tutorial)" },
  { value: "TP", label: "TP (Practical)" },
  { value: "EXAM", label: "Exam" },
  { value: "SOLUTION", label: "Solution" },
  { value: "OTHER", label: "Other" },
];

export default function UploadDocumentPage() {
  const params = useParams();
  const moduleSlug = params.moduleSlug as string;
  
  
  const { user, membership, capabilities, isLoading: authLoading, refresh } = useAuth();

  const [mod, setMod] = useState<ModuleResponse | null>(null);
  const [loadingMod, setLoadingMod] = useState(true);
  const [errorMod, setErrorMod] = useState<string | null>(null);

  // Form states
  const [title, setTitle] = useState("");
  const [type, setType] = useState("COURSE");
  const [source, setSource] = useState("STUDENT");
  const [file, setFile] = useState<File | null>(null);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<{ id: string, source: string } | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function loadModule() {
      if (!moduleSlug) return;
      try {
        const modData = await fetchApi<ModuleResponse>(`/api/v1/communities/irm/modules/${moduleSlug}`);
        setMod(modData);
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.status === 404) setErrorMod("Module not found.");
          else setErrorMod(`Failed to load module: ${err.message}`);
        } else if (err instanceof Error) {
          setErrorMod(err.message);
        } else {
          setErrorMod("Unexpected error loading module.");
        }
      } finally {
        setLoadingMod(false);
      }
    }
    loadModule();
  }, [moduleSlug]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFile = e.target.files[0];
      // Note: Backend limits are usually around 10MB to 50 MiB. Let's do a basic 50 MiB check just in case.
      if (selectedFile.size > 50 * 1024 * 1024) {
        setSubmitError("File is too large. Maximum size is 50 MiB.");
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      setFile(selectedFile);
      setSubmitError(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setSubmitError("Please select a file.");
      return;
    }
    if (!title.trim()) {
      setSubmitError("Title cannot be empty.");
      return;
    }
    if (membership?.status !== "ACTIVE") {
      setSubmitError("You must have an ACTIVE membership to upload documents.");
      return;
    }
    if (source === "OFFICIAL" && !capabilities?.upload_official_documents) {
      setSubmitError("You do not have permission to upload official documents.");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(null);

    const formData = new FormData();
    formData.append("title", title.trim());
    formData.append("type", type);
    if (capabilities?.upload_official_documents) {
      formData.append("source", source);
    } else {
      // If the caller is an ordinary member, the backend strictly requires omitting the source or explicitly setting it to STUDENT.
      formData.append("source", "STUDENT");
    }
    formData.append("file", file);

    try {
      const result = await fetchApi<DocumentResponse>(`/api/v1/communities/irm/modules/${moduleSlug}/documents`, {
        method: "POST",
        body: formData,
      });
      setSubmitSuccess({ id: result.id, source: result.source });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setSubmitError("Unauthorized. Please log in.");
        } else if (err.status === 403) {
          setSubmitError(`Permission denied: ${err.message}`);
          await refresh();
        } else if (err.status === 413) {
          setSubmitError(`File is too large: ${err.message}`);
        } else if (err.status === 415) {
          setSubmitError("Unsupported file format. Only PDF, JPEG, and PNG are allowed.");
        } else if (err.status === 422) {
          setSubmitError(`Validation error: ${err.message}`);
        } else {
          setSubmitError(`Upload failed: ${err.message}`);
        }
      } else if (err instanceof Error) {
        setSubmitError(err.message === 'Failed to fetch' || err.message.includes('Network') 
          ? "Network error: Upload completion could not be confirmed. Check the module or pending list before trying again." 
          : err.message);
      } else {
        setSubmitError("An unexpected error occurred during upload.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setTitle("");
    setType("COURSE");
    setSource("STUDENT");
    setFile(null);
    setSubmitSuccess(null);
    setSubmitError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  if (authLoading || loadingMod) {
    return <div className="p-8 font-sans max-w-2xl mx-auto mt-10 text-gray-600">Loading context...</div>;
  }

  if (errorMod || !mod) {
    return (
      <div className="p-8 font-sans max-w-2xl mx-auto mt-10">
        <Link href={`/communities/irm/modules/${moduleSlug}`} className="text-blue-600 hover:underline mb-4 inline-block">&larr; Back to Module</Link>
        <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded">{errorMod || "Module not found."}</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="p-8 font-sans max-w-2xl mx-auto mt-10">
        <Link href={`/communities/irm/modules/${moduleSlug}`} className="text-blue-600 hover:underline mb-4 inline-block">&larr; Back to Module</Link>
        <div className="p-4 bg-yellow-50 text-yellow-800 border border-yellow-200 rounded">
          Authentication required. Please <Link href="/login" className="font-semibold underline">log in</Link> to upload.
        </div>
      </div>
    );
  }

  if (!membership || membership.status !== "ACTIVE") {
    return (
      <div className="p-8 font-sans max-w-2xl mx-auto mt-10">
        <Link href={`/communities/irm/modules/${moduleSlug}`} className="text-blue-600 hover:underline mb-4 inline-block">&larr; Back to Module</Link>
        <div className="p-4 bg-yellow-50 text-yellow-800 border border-yellow-200 rounded">
          <p className="mb-2">ACTIVE IRM membership is required to upload documents.</p>
          {membership?.status ? (
            <p>Your current status is: <strong>{membership.status}</strong></p>
          ) : (
            <Link href="/communities/irm/membership" className="font-semibold underline">Request Membership</Link>
          )}
        </div>
      </div>
    );
  }

  if (submitSuccess) {
    return (
      <div className="p-8 font-sans max-w-2xl mx-auto mt-10">
        <h1 className="text-2xl font-bold mb-6">Upload to {mod.name}</h1>
        <div className="p-6 bg-green-50 border border-green-200 text-green-800 rounded-lg">
          <h2 className="text-lg font-semibold mb-2">Upload Successful</h2>
          {submitSuccess.source === "STUDENT" ? (
            <>
              <p className="mb-4">Your document has been submitted for community voting.</p>
              <p className="mb-4 text-sm text-green-700">Note: You cannot vote on your own submission.</p>
              <Link href="/communities/irm/documents/pending" className="inline-block bg-white text-green-700 font-medium px-4 py-2 rounded border border-green-300 hover:bg-green-100 mr-4">
                View Pending Documents
              </Link>
            </>
          ) : (
            <>
              <p className="mb-4">Your official document has been published immediately.</p>
              <Link href={`/communities/irm/modules/${moduleSlug}/documents/${submitSuccess.id}`} className="inline-block bg-white text-green-700 font-medium px-4 py-2 rounded border border-green-300 hover:bg-green-100 mr-4">
                View Document
              </Link>
            </>
          )}
          <button onClick={resetForm} className="mt-4 inline-block text-green-700 hover:underline font-medium">
            Upload another document
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 font-sans max-w-2xl mx-auto mt-10">
      <div className="mb-6 flex justify-between items-center">
        <Link href={`/communities/irm/modules/${moduleSlug}`} className="text-gray-500 hover:underline text-sm inline-block">
          &larr; Back to {mod.name}
        </Link>
      </div>

      <h1 className="text-2xl font-bold mb-2">Upload Document</h1>
      <p className="text-gray-500 text-sm mb-6">Module: {mod.name}</p>

      <form onSubmit={handleSubmit} className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm space-y-6">
        
        {/* Source Explanation */}
        <div className="p-4 bg-blue-50 border border-blue-100 text-blue-800 rounded text-sm space-y-2">
          {source === "STUDENT" ? (
            <>
              <p><strong>Student contribution:</strong> This document will start in the pending queue.</p>
              <p>Eligible community members will preview and vote to approve or reject it. The approval threshold is captured at the moment of upload.</p>
              <p>You cannot vote on your own document.</p>
            </>
          ) : (
            <p><strong>Official publication:</strong> This document will be published and available immediately.</p>
          )}
        </div>

        {submitError && (
          <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded text-sm">
            {submitError}
          </div>
        )}

        {capabilities?.upload_official_documents && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="source">
              Upload As
            </label>
            <select
              id="source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={submitting}
            >
              <option value="STUDENT">Student Contribution (Requires Voting)</option>
              <option value="OFFICIAL">Official Document (Immediate Publication)</option>
            </select>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="title">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            id="title"
            type="text"
            required
            maxLength={255}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={submitting}
            placeholder="e.g. Chapter 1 Notes"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="type">
            Document Type <span className="text-red-500">*</span>
          </label>
          <select
            id="type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={submitting}
          >
            {DOCUMENT_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="file">
            File <span className="text-red-500">*</span>
          </label>
          <input
            id="file"
            type="file"
            required
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            ref={fileInputRef}
            onChange={handleFileChange}
            className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
            disabled={submitting}
          />
          <p className="mt-1 text-xs text-gray-500">
            Accepted formats: PDF, JPEG, PNG.
          </p>
          {file && (
            <p className="mt-2 text-sm text-gray-700 font-medium">
              Selected: {file.name} ({(file.size / (1024 * 1024)).toFixed(2)} MB)
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded disabled:opacity-50 flex justify-center items-center gap-2"
        >
          {submitting ? "Uploading..." : `Upload as ${source === "OFFICIAL" ? "Official" : "Student"}`}
        </button>
      </form>
    </div>
  );
}
