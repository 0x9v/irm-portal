"use client";

import Link from "next/link";

/**
 * Validates the WhatsApp contact number and builds a secure wa.me URL.
 * Expected format: 7 to 15 digits only (international country code + phone number),
 * without '+', spaces, dashes, or parentheses.
 * Returns null if missing, malformed, or invalid.
 */
export function getWhatsAppSupportUrl(rawNumber: string | undefined): string | null {
  if (!rawNumber) {
    return null;
  }
  const trimmed = rawNumber.trim();
  // Strictly validate digits only, length between 7 and 15
  if (!/^\d{7,15}$/.test(trimmed)) {
    return null;
  }
  const message = "Hi! I'd like to support IRM Hub. How can I contribute?";
  return `https://wa.me/${trimmed}?text=${encodeURIComponent(message)}`;
}

export default function SupportPage() {
  const whatsAppNumber = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP_NUMBER;
  const whatsAppUrl = getWhatsAppSupportUrl(whatsAppNumber);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12 font-sans">
      {/* Navigation Breadcrumbs */}
      <nav aria-label="Breadcrumb" className="mb-6">
        <ol className="flex items-center space-x-2 text-sm text-gray-500">
          <li>
            <Link href="/" className="hover:text-blue-600 transition-colors">
              Home
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-gray-800 font-semibold" aria-current="page">
            Support
          </li>
        </ol>
      </nav>

      {/* Hero / Page Header */}
      <div className="mb-10 text-center sm:text-left border-b pb-8">
        <div className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 mb-3">
          Independent Student Project
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-gray-900 tracking-tight mb-3">
          Support IRM Hub
        </h1>
        <p className="text-base sm:text-lg text-gray-600 max-w-2xl leading-relaxed">
          IRM Hub helps IRM students share study resources, review student submissions, and follow community announcements.
        </p>
      </div>

      <div className="space-y-8">
        {/* Section: What Has Been Built */}
        <section className="bg-white border border-gray-200 rounded-xl p-6 sm:p-8 shadow-sm">
          <h2 className="text-xl font-bold text-gray-900 mb-4">
            What We Have Built
          </h2>
          <p className="text-sm text-gray-600 mb-6 leading-relaxed">
            The platform provides essential tools to support our academic studies and community collaboration:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
              <span className="text-blue-600 font-bold text-lg mt-0.5">👤</span>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Student Accounts & Membership</h3>
                <p className="text-xs text-gray-600 mt-1">
                  Account registration and verified community membership workflows for IRM classmates.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
              <span className="text-blue-600 font-bold text-lg mt-0.5">📚</span>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Document Uploads & Previews</h3>
                <p className="text-xs text-gray-600 mt-1">
                  Study document uploads with automatic first-page previews to examine quality before voting.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
              <span className="text-blue-600 font-bold text-lg mt-0.5">🗳️</span>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Student Voting</h3>
                <p className="text-xs text-gray-600 mt-1">
                  Community peer review where active members vote to approve helpful academic resources.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
              <span className="text-blue-600 font-bold text-lg mt-0.5">📥</span>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Approved Document Library</h3>
                <p className="text-xs text-gray-600 mt-1">
                  Easy browsing and downloading of approved courses, tutorials, practicals, and exams by module.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
              <span className="text-blue-600 font-bold text-lg mt-0.5">📢</span>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Community Announcements</h3>
                <p className="text-xs text-gray-600 mt-1">
                  Timely updates, schedules, and important notices published by community representatives.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
              <span className="text-blue-600 font-bold text-lg mt-0.5">🛡️</span>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Delegate & Moderator Tools</h3>
                <p className="text-xs text-gray-600 mt-1">
                  Student leadership management tools to review memberships and maintain community standards.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Section: Why Support */}
        <section className="bg-white border border-gray-200 rounded-xl p-6 sm:p-8 shadow-sm">
          <h2 className="text-xl font-bold text-gray-900 mb-4">
            Supporting the Platform
          </h2>
          <div className="space-y-3 text-sm text-gray-700 leading-relaxed">
            <p>
              IRM Hub is an independent, student-built initiative. Contributions are completely optional and help with domain costs, maintenance, and future improvements.
            </p>
            <p>
              The platform remains available under the same access rules whether a user contributes or not. Contributing does not grant special privileges, exclusive roles, or paid access to study resources.
            </p>
            <p className="text-xs text-gray-500 pt-2 border-t">
              Note: IRM Hub is an independent student initiative and is not affiliated with, operated by, or officially endorsed by the university administration. It is not a registered charity, and contributions are not tax-deductible.
            </p>
          </div>
        </section>

        {/* Section: Contact / Contribution Action */}
        <section className="bg-blue-50 border border-blue-200 rounded-xl p-6 sm:p-8 text-center sm:text-left">
          <h2 className="text-xl font-bold text-blue-900 mb-2">
            How to Contribute
          </h2>
          <p className="text-sm text-blue-800 mb-6 max-w-2xl leading-relaxed">
            If you’d like to support the project, contact me on WhatsApp to discuss how you can contribute.
          </p>

          {whatsAppUrl ? (
            <div className="space-y-4">
              <div>
                <a
                  href={whatsAppUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-6 py-3 rounded-lg shadow-sm transition-colors text-base focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
                >
                  <span aria-hidden="true" className="text-lg">💬</span>
                  Contact me to support IRM Hub
                </a>
              </div>
              <div className="text-xs text-blue-700 space-y-1 max-w-xl">
                <p>
                  &bull; This link opens an external WhatsApp conversation.
                </p>
                <p>
                  &bull; It does not charge you or process any automated payment.
                </p>
                <p>
                  &bull; Contribution details are arranged personally.
                </p>
              </div>
            </div>
          ) : (
            <div className="p-4 bg-white border border-blue-200 rounded-lg text-sm text-gray-700 max-w-lg">
              <p className="font-medium text-gray-900">
                Support contact details will be available soon.
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Thank you for your interest in supporting IRM Hub. You can also reach out directly to your student delegate.
              </p>
            </div>
          )}
        </section>

        {/* Section: Return Navigation Links */}
        <section className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t">
          <Link
            href="/"
            className="inline-flex items-center text-sm font-medium text-blue-600 hover:text-blue-800 transition-colors"
          >
            &larr; Back to Homepage
          </Link>
          <Link
            href="/communities/irm/modules"
            className="inline-flex items-center text-sm font-medium text-blue-600 hover:text-blue-800 transition-colors"
          >
            Explore IRM Modules &rarr;
          </Link>
        </section>
      </div>
    </div>
  );
}
