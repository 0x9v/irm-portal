"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchApi, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

interface AnnouncementResponse {
  id: string;
  title: string;
  content: string;
  author_id: string;
  created_at: string;
}

export default function AnnouncementsPage() {
  const { capabilities, refresh } = useAuth();
  const [announcements, setAnnouncements] = useState<AnnouncementResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const loadAnnouncements = async () => {
    try {
      const data = await fetchApi<AnnouncementResponse[]>("/api/v1/communities/irm/announcements");
      setAnnouncements(data);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setError("Unauthorized. Please log in.");
        } else if (err.status === 403) {
          setError("Forbidden. You must be an active member of this community to view announcements.");
        } else {
          setError(`Failed to load announcements: ${err.message}`);
        }
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An unexpected error occurred.");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAnnouncements();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    setFormSuccess(null);

    try {
      await fetchApi("/api/v1/communities/irm/announcements", {
        method: "POST",
        body: JSON.stringify({ title, content }),
      });
      setFormSuccess("Announcement created successfully.");
      setTitle("");
      setContent("");
      // Refresh list
      // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAnnouncements();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 403) {
          setFormError("Forbidden. You do not have permission to create announcements.");
          await refresh(); // Refresh context and hide the form if revoked
        } else if (err.status === 422) {
          setFormError(`Validation error: ${err.message}`);
        } else {
          setFormError(`Creation failed: ${err.message}`);
        }
      } else if (err instanceof Error) {
        setFormError(err.message);
      } else {
        setFormError("An unexpected error occurred.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 font-sans max-w-4xl mx-auto mt-10 text-gray-600">
        Loading announcements...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 font-sans max-w-4xl mx-auto mt-10">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">IRM Announcements</h1>
          <div className="flex gap-4">
            <Link href="/communities/irm/modules" className="text-blue-600 hover:underline text-sm">
              Modules
            </Link>
            <Link href="/communities/irm/membership" className="text-blue-600 hover:underline text-sm">
              Membership
            </Link>
          </div>
        </div>
        <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 font-sans max-w-4xl mx-auto mt-10">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">IRM Announcements</h1>
        <div className="flex gap-4">
          <Link href="/communities/irm/modules" className="text-blue-600 hover:underline text-sm">
            Modules
          </Link>
          <Link href="/communities/irm/membership" className="text-blue-600 hover:underline text-sm">
            Membership
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          {announcements.length === 0 ? (
            <div className="text-gray-600 p-6 bg-white border border-gray-200 rounded-lg shadow-sm">
              No announcements found.
            </div>
          ) : (
            announcements.map((announcement) => (
              <div key={announcement.id} className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm">
                <h2 className="text-xl font-semibold mb-2">{announcement.title}</h2>
                <div className="text-sm text-gray-500 mb-4 flex flex-col gap-1">
                  <span>Posted: {new Date(announcement.created_at).toLocaleString()}</span>
                </div>
                <div className="text-gray-800 whitespace-pre-wrap">{announcement.content}</div>
              </div>
            ))
          )}
        </div>

        {capabilities?.create_announcements && (
          <div>
            <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm sticky top-8">
              <h3 className="text-lg font-semibold mb-4">Post Announcement</h3>
              
              {formSuccess && (
                <div className="mb-4 p-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded">
                  {formSuccess}
                </div>
              )}
              
              {formError && (
                <div className="mb-4 p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded">
                  {formError}
                </div>
              )}

              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="title">
                    Title
                  </label>
                  <input
                    id="title"
                    type="text"
                    required
                    className="w-full p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="content">
                    Content
                  </label>
                  <textarea
                    id="content"
                    required
                    rows={4}
                    className="w-full p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? "Posting..." : "Post Announcement"}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
