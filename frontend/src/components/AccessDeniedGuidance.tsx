import Link from "next/link";
import { buttonStyles } from "@/components/ui/Button";
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
      <div className="ui-surface max-w-2xl mx-auto my-6">
        <h2 className="ui-section-heading text-text mb-2">Resource Not Found</h2>
        <p className="text-text-muted mb-6 text-base leading-6">{notFoundMessage || "The requested module or document could not be found."}</p>
        <Link
          href={returnHref}
          className={buttonStyles("quiet")}
        >
          &larr; Back to {returnLabel}
        </Link>
      </div>
    );
  }

  if (isGuest) {
    return (
      <div className="ui-surface max-w-2xl mx-auto my-6">
        <div className="inline-block px-2.5 py-1 rounded-tag text-sm font-semibold bg-warning-surface text-warning border border-warning-border mb-3">
          Login Required
        </div>
        <h2 className="ui-section-heading text-text mb-2">Authentication Needed</h2>
        <p className="text-text-muted mb-6 text-base leading-6">
          This community area requires an account. Please log in to your account or register to participate in the IRM community.
        </p>
        <div className="flex flex-wrap gap-3 items-center">
          <Link
            href="/login"
            className={buttonStyles("primary")}
          >
            Log In
          </Link>
          <Link
            href="/register"
            className={buttonStyles("secondary")}
          >
            Create an Account
          </Link>
          <Link
            href={returnHref}
            className={buttonStyles("quiet")}
          >
            &larr; Back to {returnLabel}
          </Link>
        </div>
      </div>
    );
  }

  if (missingPermission && membershipStatus === "ACTIVE") {
    return (
      <div className="ui-surface max-w-2xl mx-auto my-6">
        <div className="inline-block px-2.5 py-1 rounded-tag text-sm font-semibold bg-error-surface text-error border border-error-border mb-3">
          Permission Restricted
        </div>
        <h2 className="ui-section-heading text-text mb-2">Staff Authorization Required</h2>
        <p className="text-text-muted mb-6 text-base leading-6">
          You are an active community member, but this action requires {missingPermission}. If you need this privilege, please contact the IRM community Delegate.
        </p>
        <div className="flex flex-wrap gap-3 items-center">
          <Link
            href={returnHref}
            className={buttonStyles("primary")}
          >
            Back to {returnLabel}
          </Link>
          <Link
            href="/account#community-membership"
            className={buttonStyles("quiet")}
          >
            View Membership Status
          </Link>
        </div>
      </div>
    );
  }

  if (membershipStatus === "PENDING") {
    return (
      <div className="ui-surface max-w-2xl mx-auto my-6">
        <div className="inline-block px-2.5 py-1 rounded-tag text-sm font-semibold bg-warning-surface text-warning border border-warning-border mb-3">
          Application Pending
        </div>
        <h2 className="ui-section-heading text-text mb-2">Membership Under Review</h2>
        <p className="text-text-muted mb-6 text-base leading-6">
          Your IRM membership application has been submitted and is currently awaiting manual verification by the community Delegate. Once approved, you will have access to pending documents, community voting, and resource contributions.
        </p>
        <div className="flex flex-wrap gap-3 items-center">
          <Link
            href="/account#community-membership"
            className={buttonStyles("primary")}
          >
            Check Application Status
          </Link>
          <Link
            href={returnHref}
            className={buttonStyles("quiet")}
          >
            &larr; Back to {returnLabel}
          </Link>
        </div>
      </div>
    );
  }

  if (membershipStatus === "REJECTED") {
    return (
      <div className="ui-surface max-w-2xl mx-auto my-6">
        <div className="inline-block px-2.5 py-1 rounded-tag text-sm font-semibold bg-error-surface text-error border border-error-border mb-3">
          Application Rejected
        </div>
        <h2 className="ui-section-heading text-text mb-2">Membership Request Not Approved</h2>
        <p className="text-text-muted mb-6 text-base leading-6">
          Your previous IRM membership application was not approved. You can submit a new application with your correct student CNE through the membership page.
        </p>
        <div className="flex flex-wrap gap-3 items-center">
          <Link
            href="/account#community-membership"
            className={buttonStyles("primary")}
          >
            Reapply for Membership
          </Link>
          <Link
            href={returnHref}
            className={buttonStyles("quiet")}
          >
            &larr; Back to {returnLabel}
          </Link>
        </div>
      </div>
    );
  }

  if (membershipStatus === "REMOVED" || membershipStatus === "BANNED" || (membershipStatus && membershipStatus !== "ACTIVE")) {
    const removed = membershipStatus === "REMOVED";
    const banned = membershipStatus === "BANNED";
    return <div className="ui-surface max-w-2xl mx-auto my-6">
      <h2 className="ui-section-heading text-text mb-2">{removed ? "Community Membership Ended" : banned ? "Community Access Restricted" : "Membership Status Unavailable"}</h2>
      <p className="text-text-muted mb-6 text-base leading-6">{removed
        ? "Your IRM community membership has ended. Your account remains available, and you may apply again."
        : banned ? "Your IRM community access is restricted. Reapplication is unavailable. Contact Support for help."
        : "Your current membership status does not grant community access. Check your membership status or contact Support."}</p>
      <div className="flex flex-wrap gap-3">
        {removed && <Link href="/account#community-membership" className={buttonStyles("primary")}>Reapply for Membership</Link>}
        <Link href="/support" className={buttonStyles("quiet")}>Support</Link>
        <Link href={returnHref} className={buttonStyles("quiet")}>Back to {returnLabel}</Link>
      </div>
    </div>;
  }

  // No membership
  return (
    <div className="ui-surface max-w-2xl mx-auto my-6">
      <div className="inline-block px-2.5 py-1 rounded-tag text-sm font-semibold bg-info-surface text-info border border-info-border mb-3">
        Membership Required
      </div>
      <h2 className="ui-section-heading text-text mb-2">Join the IRM Community</h2>
      <p className="text-text-muted mb-6 text-base leading-6">
        This area requires active IRM membership. You have an account, but have not yet joined the IRM community. Submit an application from your account to request membership.
      </p>
      <div className="flex flex-wrap gap-3 items-center">
        <Link
          href="/account#community-membership"
          className={buttonStyles("primary")}
        >
          Request IRM Membership
        </Link>
        <Link
          href={returnHref}
          className={buttonStyles("quiet")}
        >
          &larr; Back to {returnLabel}
        </Link>
      </div>
    </div>
  );
}
