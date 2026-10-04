"use client";

import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";

export default function Header() {
  const { user, membership, capabilities, isLoading, error, logout } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await logout();
      router.push("/login");
    } catch (err) {
      alert("Logout failed: " + (err instanceof Error ? err.message : "Unknown error"));
      setIsLoggingOut(false);
    }
  };

  const isActive = (path: string) => {
    if (path === "/") return pathname === "/";
    return pathname.startsWith(path);
  };

  const linkClass = (path: string) =>
    `text-sm font-medium transition-colors ${
      isActive(path)
        ? "text-blue-600 border-b-2 border-blue-600 pb-0.5"
        : "text-gray-600 hover:text-gray-900"
    }`;

  const isActiveMember = membership?.status === "ACTIVE";
  const isDelegate = isActiveMember && membership?.role === "DELEGATE";

  return (
    <header className="bg-white shadow-sm border-b px-4 sm:px-6 py-3">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-y-3 gap-x-4">
        {/* Brand & Primary Navigation */}
        <div className="flex flex-wrap items-center gap-y-2 gap-x-6">
          <Link
            href="/"
            className="font-bold text-lg text-blue-700 hover:text-blue-800 tracking-tight"
          >
            IRM Hub
          </Link>

          <nav className="flex flex-wrap items-center gap-y-1 gap-x-4" aria-label="Main Navigation">
            <Link href="/communities/irm/modules" className={linkClass("/communities/irm/modules")}>
              Modules
            </Link>

            <Link href="/communities/irm/announcements" className={linkClass("/communities/irm/announcements")}>
              Announcements
            </Link>

            <Link href="/communities/irm/membership" className={linkClass("/communities/irm/membership")}>
              Membership
            </Link>

            <Link href="/support" className={linkClass("/support")}>
              Support
            </Link>

            {/* Privileged Nav Items based on backend-derived capabilities and active status */}
            {!isLoading && isActiveMember && (
              <Link href="/communities/irm/documents/pending" className={linkClass("/communities/irm/documents/pending")}>
                Pending Docs
              </Link>
            )}

            {!isLoading && capabilities?.manage_document_voting && (
              <Link
                href="/communities/irm/document-voting/settings"
                className={linkClass("/communities/irm/document-voting/settings")}
              >
                Voting Settings
              </Link>
            )}

            {!isLoading && isDelegate && (
              <>
                <Link
                  href="/communities/irm/membership/review"
                  className={linkClass("/communities/irm/membership/review")}
                >
                  Review Queue
                </Link>
                <Link
                  href="/communities/irm/membership/staff"
                  className={linkClass("/communities/irm/membership/staff")}
                >
                  Staff Management
                </Link>
              </>
            )}
          </nav>
        </div>

        {/* User / Authentication Actions */}
        <div className="flex items-center gap-3 text-sm">
          {isLoading ? (
            <span className="text-gray-400 text-xs">Loading session...</span>
          ) : error ? (
            <span className="text-red-500 text-xs">Session error</span>
          ) : user ? (
            <div className="flex items-center gap-3">
              <div className="flex flex-col text-right">
                <span className="font-semibold text-gray-800 text-sm">
                  {user.first_name} {user.family_name}
                </span>
                {membership ? (
                  <span className="text-xs font-semibold text-blue-700">
                    {membership.status} {membership.role}
                  </span>
                ) : (
                  <span className="text-xs text-gray-500">No membership</span>
                )}
              </div>
              <button
                type="button"
                onClick={handleLogout}
                disabled={isLoggingOut}
                className="text-gray-600 hover:text-gray-900 border border-gray-300 rounded px-2.5 py-1 text-xs hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                {isLoggingOut ? "Logging out..." : "Logout"}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href="/login"
                className="text-gray-700 hover:text-blue-600 px-2.5 py-1 text-sm font-medium rounded hover:bg-gray-100 transition-colors"
              >
                Log In
              </Link>
              <Link
                href="/register"
                className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 text-sm font-medium rounded shadow-sm transition-colors"
              >
                Register
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
