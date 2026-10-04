"use client";

import Link from "next/link";
import { useAuth } from "@/context/AuthContext";

export default function Home() {
  const { user, membership, isLoading } = useAuth();

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-14 font-sans">
      {/* Hero Section */}
      <section className="text-center mb-12 sm:mb-16">
        <div className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 mb-4">
          Pre-Alpha Release &bull; FST Mohammedia
        </div>
        <h1 className="text-3xl sm:text-5xl font-extrabold text-gray-900 tracking-tight mb-4">
          Welcome to IRM Hub
        </h1>
        <p className="text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto mb-2">
          An academic community platform designed by and for IRM students at Faculté des Sciences et Techniques de Mohammedia.
        </p>
        <p className="text-xs sm:text-sm text-gray-500 max-w-xl mx-auto mb-8">
          Independent student initiative. Not officially affiliated with or endorsed by FST Mohammedia administration.
        </p>

        {/* Primary Call to Action */}
        <div className="flex flex-wrap justify-center items-center gap-4">
          <Link
            href="/communities/irm/modules"
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-3 rounded-lg shadow-sm transition-colors text-base"
          >
            Explore IRM
          </Link>

          {!isLoading && !user && (
            <>
              <Link
                href="/login"
                className="bg-white hover:bg-gray-50 text-gray-800 font-medium px-6 py-3 rounded-lg border border-gray-300 shadow-sm transition-colors text-base"
              >
                Log In
              </Link>
              <Link
                href="/register"
                className="bg-gray-100 hover:bg-gray-200 text-gray-800 font-medium px-6 py-3 rounded-lg border border-gray-200 shadow-sm transition-colors text-base"
              >
                Create an Account
              </Link>
            </>
          )}

          {!isLoading && user && (
            <Link
              href="/communities/irm/membership"
              className="bg-white hover:bg-gray-50 text-gray-800 font-medium px-6 py-3 rounded-lg border border-gray-300 shadow-sm transition-colors text-base"
            >
              Membership Status ({membership?.status || "NOT APPLIED"})
            </Link>
          )}
        </div>

        {!isLoading && user && (
          <p className="mt-4 text-sm text-gray-600">
            Signed in as <span className="font-semibold text-gray-900">{user.first_name} {user.family_name}</span> (@{user.username})
          </p>
        )}
      </section>

      {/* Feature Cards */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        <div className="p-6 bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition-shadow">
          <div className="w-10 h-10 bg-blue-100 text-blue-700 rounded-lg flex items-center justify-center font-bold text-lg mb-4">
            📚
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Module Resources</h2>
          <p className="text-gray-600 text-sm leading-relaxed mb-4">
            Browse verified courses, tutorials (TD), practicals (TP), and exams organized by academic module.
          </p>
          <Link
            href="/communities/irm/modules"
            className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
          >
            Browse Modules &rarr;
          </Link>
        </div>

        <div className="p-6 bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition-shadow">
          <div className="w-10 h-10 bg-indigo-100 text-indigo-700 rounded-lg flex items-center justify-center font-bold text-lg mb-4">
            🗳️
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Peer Verification</h2>
          <p className="text-gray-600 text-sm leading-relaxed mb-4">
            Student uploads enter a pending queue where active members preview first pages and vote to ensure quality.
          </p>
          <Link
            href="/communities/irm/documents/pending"
            className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
          >
            Pending Review &rarr;
          </Link>
        </div>

        <div className="p-6 bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition-shadow">
          <div className="w-10 h-10 bg-amber-100 text-amber-700 rounded-lg flex items-center justify-center font-bold text-lg mb-4">
            📢
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Announcements</h2>
          <p className="text-gray-600 text-sm leading-relaxed mb-4">
            Stay up to date with community news, schedules, and important notices shared by authorized representatives.
          </p>
          <Link
            href="/communities/irm/announcements"
            className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
          >
            Read Announcements &rarr;
          </Link>
        </div>
      </section>

      {/* Community Membership Notice */}
      <section className="p-6 sm:p-8 bg-blue-50 border border-blue-100 rounded-xl text-blue-900">
        <h3 className="text-lg font-bold mb-2">How IRM Membership Works</h3>
        <p className="text-sm leading-relaxed mb-4 text-blue-800 max-w-3xl">
          Creating an account allows you to explore modules and access approved documents. Contributing new documents, viewing document previews, and voting on pending resources require an <strong>ACTIVE IRM membership</strong>, verified manually by the community Delegate using your student CNE.
        </p>
        <Link
          href="/communities/irm/membership"
          className="inline-block bg-blue-700 hover:bg-blue-800 text-white font-medium text-sm px-4 py-2 rounded-lg transition-colors"
        >
          {user ? "Manage Your Membership" : "Learn About Membership"}
        </Link>
      </section>
    </div>
  );
}
