"use client";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Header() {
  const { user, membership, isLoading, error, logout } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const router = useRouter();

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

  return (
    <header className="bg-white shadow-sm border-b px-6 py-4 flex justify-between items-center">
      <div className="font-semibold text-lg text-gray-800">
        <Link href="/communities/irm/modules">IRM Platform</Link>
      </div>
      
      <div className="flex items-center space-x-4 text-sm">
        {isLoading ? (
          <span className="text-gray-500">Loading...</span>
        ) : error ? (
          <span className="text-red-500">Error loading session</span>
        ) : user ? (
          <>
            <div className="flex flex-col text-right">
              <span className="font-medium text-gray-800">
                {user.first_name} {user.family_name}
              </span>
              {membership && (
                <span className="text-xs text-gray-500 font-medium">
                  {membership.status} {membership.role}
                </span>
              )}
            </div>
            <button
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="text-gray-600 hover:text-gray-900 border border-gray-300 rounded px-3 py-1 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              {isLoggingOut ? "Logging out..." : "Logout"}
            </button>
          </>
        ) : (
          <>
            <Link href="/login" className="text-blue-600 hover:underline">
              Login
            </Link>
            <Link href="/register" className="text-blue-600 hover:underline">
              Register
            </Link>
          </>
        )}
      </div>
    </header>
  );
}
