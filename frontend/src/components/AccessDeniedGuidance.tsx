import Link from "next/link";
import { MembershipStatus } from "@/context/AuthContext";

interface AccessDeniedGuidanceProps {
  isGuest?: boolean;
  membershipStatus?: MembershipStatus | null;
  missingPermission?: string;
  isNotFound?: boolean;
  notFoundMessage?: string;
  returnHref?: string;
  returnLabel?: string;
}

export default function AccessDeniedGuidance({
  isGuest,
  membershipStatus,
  missingPermission,
  isNotFound,
  notFoundMessage,
  returnHref = "/communities/irm/modules",
  returnLabel = "Explore Modules",
}: AccessDeniedGuidanceProps) {
  if (isNotFound) {
    return (
      <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm max-w-2xl mx-auto mt-8">
        <h2 className="text-xl font-bold text-gray-800 mb-2">Resource Not Found</h2>
        <p className="text-gray-600 mb-6">{notFoundMessage || "The requested module or document could not be found."}</p>
        <Link
          href={returnHref}
          className="inline-flex items-center text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
        >
          &larr; Back to {returnLabel}
        </Link>
      </div>
    );
  }

  if (isGuest) {
    return (
      <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm max-w-2xl mx-auto mt-8">
        <div className="inline-block px-2.5 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800 mb-3">
          Login Required
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Authentication Needed</h2>
        <p className="text-gray-600 mb-6">
          This community area requires an account. Please log in to your account or register to participate in the IRM community.
        </p>
        <div className="flex flex-wrap gap-3 items-center">
          <Link
            href="/login"
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded text-sm transition-colors"
          >
            Log In
          </Link>
          <Link
            href="/register"
            className="bg-gray-100 hover:bg-gray-200 text-gray-800 font-medium px-4 py-2 rounded text-sm border border-gray-300 transition-colors"
          >
            Create an Account
          </Link>
          <Link
            href={returnHref}
            className="text-sm text-gray-600 hover:text-gray-900 hover:underline ml-2"
          >
            &larr; Back to {returnLabel}
          </Link>
        </div>
      </div>
    );
  }

  if (missingPermission) {
    return (
      <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm max-w-2xl mx-auto mt-8">
        <div className="inline-block px-2.5 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-800 mb-3">
          Permission Restricted
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Staff Authorization Required</h2>
        <p className="text-gray-600 mb-6">
          You are an active community member, but this action requires {missingPermission}. If you need this privilege, please contact the IRM community Delegate.
        </p>
        <div className="flex flex-wrap gap-3 items-center">
          <Link
            href={returnHref}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded text-sm transition-colors"
          >
            Back to {returnLabel}
          </Link>
          <Link
            href="/communities/irm/membership"
            className="text-sm text-gray-600 hover:text-gray-900 hover:underline ml-2"
          >
            View Membership Status
          </Link>
        </div>
      </div>
    );
  }

  if (membershipStatus === "PENDING") {
    return (
      <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm max-w-2xl mx-auto mt-8">
        <div className="inline-block px-2.5 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800 mb-3">
          Application Pending
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Membership Under Review</h2>
        <p className="text-gray-600 mb-6">
          Your IRM membership application has been submitted and is currently awaiting manual verification by the community Delegate. Once approved, you will have access to pending documents, community voting, and resource contributions.
        </p>
        <div className="flex flex-wrap gap-3 items-center">
          <Link
            href="/communities/irm/membership"
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded text-sm transition-colors"
          >
            Check Application Status
          </Link>
          <Link
            href={returnHref}
            className="text-sm text-gray-600 hover:text-gray-900 hover:underline ml-2"
          >
            &larr; Back to {returnLabel}
          </Link>
        </div>
      </div>
    );
  }

  if (membershipStatus === "REJECTED") {
    return (
      <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm max-w-2xl mx-auto mt-8">
        <div className="inline-block px-2.5 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-800 mb-3">
          Application Rejected
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Membership Request Not Approved</h2>
        <p className="text-gray-600 mb-6">
          Your previous IRM membership application was not approved. You can submit a new application with your correct student CNE through the membership page.
        </p>
        <div className="flex flex-wrap gap-3 items-center">
          <Link
            href="/communities/irm/membership"
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded text-sm transition-colors"
          >
            Reapply for Membership
          </Link>
          <Link
            href={returnHref}
            className="text-sm text-gray-600 hover:text-gray-900 hover:underline ml-2"
          >
            &larr; Back to {returnLabel}
          </Link>
        </div>
      </div>
    );
  }

  // No membership
  return (
    <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm max-w-2xl mx-auto mt-8">
      <div className="inline-block px-2.5 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-800 mb-3">
        Membership Required
      </div>
      <h2 className="text-xl font-bold text-gray-900 mb-2">Join the IRM Community</h2>
      <p className="text-gray-600 mb-6">
        This area requires active IRM membership. You have an account, but have not yet joined the IRM community. Submit your student CNE to request membership.
      </p>
      <div className="flex flex-wrap gap-3 items-center">
        <Link
          href="/communities/irm/membership"
          className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded text-sm transition-colors"
        >
          Request IRM Membership
        </Link>
        <Link
          href={returnHref}
          className="text-sm text-gray-600 hover:text-gray-900 hover:underline ml-2"
        >
          &larr; Back to {returnLabel}
        </Link>
      </div>
    </div>
  );
}
