"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { buttonStyles } from "@/components/ui/Button";

export default function Header() {
  const { user, membership, membershipError, capabilities, isLoading, isRefreshing, isLoggingOut: authLoggingOut, logout } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isManageOpen, setIsManageOpen] = useState(false);
  const [localLoggingOut, setLocalLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  const isLoggingOut = authLoggingOut || localLoggingOut;

  const router = useRouter();
  const pathname = usePathname();

  const mobileToggleRef = useRef<HTMLButtonElement>(null);
  const manageDropdownRef = useRef<HTMLDivElement>(null);
  const manageToggleRef = useRef<HTMLButtonElement>(null);

  const isActiveMember = !isLoading && membership?.status === "ACTIVE";
  const isDelegate = !isLoading && isActiveMember && membership?.role === "DELEGATE";
  const canManageVoting = !isLoading && Boolean(capabilities?.manage_document_voting);
  const hasManagementLinks = isDelegate || canManageVoting;

  const isPathActive = (current: string, target: string) =>
    current === target || current.startsWith(`${target}/`);

  // Active section identification
  const isHomeActive = pathname === "/";
  const isPendingDocsActive = isPathActive(pathname, "/communities/irm/documents/pending");
  const isSavedDocsActive = isPathActive(pathname, "/communities/irm/documents/saved");
  const isReviewActive = isPathActive(pathname, "/communities/irm/membership/review");
  const isStaffActive = isPathActive(pathname, "/communities/irm/membership/staff");
  const isVotingSettingsActive = isPathActive(pathname, "/communities/irm/document-voting/settings");
  const isModulesActive = isPathActive(pathname, "/communities/irm/modules");
  const isAnnouncementsActive = isPathActive(pathname, "/communities/irm/announcements");
  const isPostsActive = isPathActive(pathname, "/communities/irm/posts");
  const isDiscussionActive = isPathActive(pathname, "/communities/irm/discussion");
  const isSupportActive = isPathActive(pathname, "/support");
  const isManageActive = isReviewActive || isStaffActive || isVotingSettingsActive;

  // Close menus and reset state on route navigation or account change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMobileMenuOpen(false);
    setIsManageOpen(false);
    setLogoutError(null);
    setLocalLoggingOut(false);
  }, [pathname, user]);

  // Handle keyboard dismissal with Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isMobileMenuOpen) {
          setIsMobileMenuOpen(false);
          mobileToggleRef.current?.focus();
        }
        if (isManageOpen) {
          setIsManageOpen(false);
          manageToggleRef.current?.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isMobileMenuOpen, isManageOpen]);

  // Handle click outside management dropdown on desktop
  useEffect(() => {
    if (!isManageOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        manageDropdownRef.current &&
        !manageDropdownRef.current.contains(e.target as Node)
      ) {
        setIsManageOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isManageOpen]);

  // Close mobile menu on desktop viewport expansion
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setIsMobileMenuOpen(false);
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setLocalLoggingOut(true);
    setLogoutError(null);
    try {
      await logout();
      router.push("/login");
    } catch (err) {
      const msg =
        err instanceof Error && err.name === "AbortError"
          ? "Logout request timed out. Please try again."
          : "Logout failed. Please try again.";
      setLogoutError(msg);
    } finally {
      setLocalLoggingOut(false);
    }
  };

  const desktopLinkClass = (isActive: boolean) =>
    `ui-nav-link px-2 py-2 text-sm leading-5 rounded-control min-h-[44px] flex items-center border-b-2 whitespace-nowrap ${
      isActive
        ? "font-semibold text-accent bg-accent-soft border-accent"
        : "font-medium text-text-muted hover:text-text hover:bg-surface-secondary border-transparent"
    }`;

  const mobileLinkClass = (isActive: boolean) =>
    `ui-nav-link flex items-center min-h-[44px] px-3 py-2 text-base leading-6 rounded-control border-l-2 ${
      isActive
        ? "font-semibold text-accent bg-accent-soft border-accent"
        : "font-medium text-text-muted hover:text-text hover:bg-surface-secondary border-transparent"
    }`;

  return (
    <header className="bg-surface border-b border-border">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 xl:grid-cols-[auto_minmax(0,1fr)_auto]">
          {/* Brand & Desktop Navigation */}
          <div className="contents">
            <Link
              href="/"
              className="ui-nav-link col-start-1 row-start-1 justify-self-start font-semibold text-lg leading-7 text-accent hover:text-accent-hover tracking-tight flex items-center min-h-16 rounded-control"
            >
              IRM Hub
            </Link>

            <nav
              className="hidden lg:flex lg:col-span-2 lg:row-start-2 xl:col-span-1 xl:col-start-2 xl:row-start-1 items-center flex-wrap gap-1 min-w-0 pb-2 xl:py-2"
              aria-label="Main Navigation"
            >
              <Link
                href="/"
                className={desktopLinkClass(isHomeActive)}
                aria-current={isHomeActive ? "page" : undefined}
              >
                Home
              </Link>

              <Link
                href="/communities/irm/modules"
                className={desktopLinkClass(isModulesActive)}
                aria-current={isModulesActive ? "page" : undefined}
              >
                Modules
              </Link>

              {user && (
                <Link
                  href="/communities/irm/documents/saved"
                  className={desktopLinkClass(isSavedDocsActive)}
                  aria-current={isSavedDocsActive ? "page" : undefined}
                >
                  Saved Documents
                </Link>
              )}

              <Link
                href="/communities/irm/announcements"
                className={desktopLinkClass(isAnnouncementsActive)}
                aria-current={isAnnouncementsActive ? "page" : undefined}
              >
                Announcements
              </Link>

              {isActiveMember && (
                <Link
                  href="/communities/irm/posts"
                  className={desktopLinkClass(isPostsActive)}
                  aria-current={isPostsActive ? "page" : undefined}
                >
                  Posts
                </Link>
              )}

              {isActiveMember && (
                <Link
                  href="/communities/irm/discussion"
                  className={desktopLinkClass(isDiscussionActive)}
                  aria-current={isDiscussionActive ? "page" : undefined}
                >
                  Discussion
                </Link>
              )}

              {isActiveMember && (
                <Link
                  href="/communities/irm/documents/pending"
                  className={desktopLinkClass(isPendingDocsActive)}
                  aria-current={isPendingDocsActive ? "page" : undefined}
                >
                  Pending Docs
                </Link>
              )}

              <Link
                href="/support"
                className={desktopLinkClass(isSupportActive)}
                aria-current={isSupportActive ? "page" : undefined}
              >
                Support
              </Link>

              {/* Management Dropdown for desktop */}
              {hasManagementLinks && (
                <div className="relative" ref={manageDropdownRef}>
                  <button
                    type="button"
                    ref={manageToggleRef}
                    onClick={() => setIsManageOpen((prev) => !prev)}
                    aria-expanded={isManageOpen}
                    aria-haspopup="true"
                    className={`${desktopLinkClass(isManageActive)} gap-1`}
                  >
                    Manage
                    <svg
                      className={`w-4 h-4 ui-menu-icon ${isManageOpen ? "rotate-180" : ""}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {isManageOpen && (
                    <div
                      role="menu"
                      aria-label="Management destinations"
                      className="absolute right-0 mt-1 w-60 max-w-[calc(100vw-2rem)] bg-surface border border-border rounded-surface shadow-overlay py-2 z-50"
                    >
                      {isDelegate && (
                        <>
                          <Link
                            href="/communities/irm/membership/review"
                            role="menuitem"
                            onClick={() => setIsManageOpen(false)}
                            aria-current={isReviewActive ? "page" : undefined}
                            className={`ui-nav-link flex items-center min-h-[44px] px-4 py-2 text-sm leading-5 border-l-2 ${
                              isReviewActive
                                ? "border-accent bg-accent-soft text-accent font-semibold"
                                : "border-transparent text-text-muted hover:bg-surface-secondary hover:text-text"
                            }`}
                          >
                            Review Applications
                          </Link>
                          <Link
                            href="/communities/irm/membership/staff"
                            role="menuitem"
                            onClick={() => setIsManageOpen(false)}
                            aria-current={isStaffActive ? "page" : undefined}
                            className={`ui-nav-link flex items-center min-h-[44px] px-4 py-2 text-sm leading-5 border-l-2 ${
                              isStaffActive
                                ? "border-accent bg-accent-soft text-accent font-semibold"
                                : "border-transparent text-text-muted hover:bg-surface-secondary hover:text-text"
                            }`}
                          >
                            Manage Staff
                          </Link>
                        </>
                      )}

                      {canManageVoting && (
                        <Link
                          href="/communities/irm/document-voting/settings"
                          role="menuitem"
                          onClick={() => setIsManageOpen(false)}
                          aria-current={isVotingSettingsActive ? "page" : undefined}
                          className={`ui-nav-link flex items-center min-h-[44px] px-4 py-2 text-sm leading-5 border-l-2 ${
                            isVotingSettingsActive
                              ? "border-accent bg-accent-soft text-accent font-semibold"
                              : "border-transparent text-text-muted hover:bg-surface-secondary hover:text-text"
                          }`}
                        >
                          Voting Settings
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              )}
            </nav>
          </div>

          {/* Desktop Account Controls */}
          <div className="hidden lg:flex lg:col-start-2 lg:row-start-1 xl:col-start-3 items-center justify-self-end min-w-0">
            {isLoading ? (
              <div
                className="ui-account-placeholder w-28 h-8 bg-surface-secondary rounded-control"
                aria-label="Loading account status"
              />
            ) : user ? (
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex flex-col text-right text-sm leading-5 min-w-0 max-w-[200px]">
                  <span
                    className="font-semibold text-text text-sm truncate"
                    title={user.username}
                  >
                    {user.username}
                  </span>
                  {isRefreshing && !membership ? (
                    <span className="text-sm text-text-muted">Checking membership…</span>
                  ) : membershipError ? (
                    <span className="text-sm text-text-muted">Membership unavailable</span>
                  ) : membership ? (
                    <span className="text-sm text-text-muted">
                      {membership.status} {membership.role}
                    </span>
                  ) : (
                    <span className="text-sm text-text-muted">No membership</span>
                  )}
                </div>

                <div className="flex flex-col items-end min-w-0 max-w-[240px]">
                  <button
                    type="button"
                    onClick={handleLogout}
                    disabled={isLoggingOut}
                    className={buttonStyles("secondary")}
                  >
                    {isLoggingOut ? "Logging out..." : "Logout"}
                  </button>
                  {logoutError && (
                    <span role="alert" className="text-sm leading-5 text-error mt-1 [overflow-wrap:anywhere]">
                      {logoutError}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Link
                  href="/login"
                  className={buttonStyles("quiet")}
                >
                  Log In
                </Link>
                <Link
                  href="/register"
                  className={buttonStyles("primary")}
                >
                  Register
                </Link>
              </div>
            )}
          </div>

          {/* Mobile Menu Toggle Button */}
          <div className="flex lg:hidden items-center col-start-2 row-start-1">
            <button
              type="button"
              ref={mobileToggleRef}
              onClick={() => setIsMobileMenuOpen((prev) => !prev)}
              aria-expanded={isMobileMenuOpen}
              aria-controls="mobile-navigation"
              aria-label={isMobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
              className="ui-nav-link p-2 text-text-muted hover:text-text hover:bg-surface-secondary rounded-control min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              {isMobileMenuOpen ? (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Navigation Panel */}
      {isMobileMenuOpen && (
        <div
          id="mobile-navigation"
          className="lg:hidden border-t border-border bg-surface px-4 sm:px-6 pt-3 pb-6 space-y-4"
        >
          <nav aria-label="Mobile Navigation" className="space-y-4">
            {/* Primary Navigation */}
            <div className="space-y-1">
              <div className="text-sm leading-5 font-semibold text-text-muted px-3 py-1">
                Navigation
              </div>
              <Link
                href="/"
                onClick={() => setIsMobileMenuOpen(false)}
                className={mobileLinkClass(isHomeActive)}
                aria-current={isHomeActive ? "page" : undefined}
              >
                Home
              </Link>
              <Link
                href="/communities/irm/modules"
                onClick={() => setIsMobileMenuOpen(false)}
                className={mobileLinkClass(isModulesActive)}
                aria-current={isModulesActive ? "page" : undefined}
              >
                Modules
              </Link>
              {user && (
                <Link
                  href="/communities/irm/documents/saved"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={mobileLinkClass(isSavedDocsActive)}
                  aria-current={isSavedDocsActive ? "page" : undefined}
                >
                  Saved Documents
                </Link>
              )}
              <Link
                href="/communities/irm/announcements"
                onClick={() => setIsMobileMenuOpen(false)}
                className={mobileLinkClass(isAnnouncementsActive)}
                aria-current={isAnnouncementsActive ? "page" : undefined}
              >
                Announcements
              </Link>
              {isActiveMember && (
                <Link
                  href="/communities/irm/posts"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={mobileLinkClass(isPostsActive)}
                  aria-current={isPostsActive ? "page" : undefined}
                >
                  Posts
                </Link>
              )}
              {isActiveMember && (
                <Link
                  href="/communities/irm/discussion"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={mobileLinkClass(isDiscussionActive)}
                  aria-current={isDiscussionActive ? "page" : undefined}
                >
                  Discussion
                </Link>
              )}
              {isActiveMember && (
                <Link
                  href="/communities/irm/documents/pending"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={mobileLinkClass(isPendingDocsActive)}
                  aria-current={isPendingDocsActive ? "page" : undefined}
                >
                  Pending Docs
                </Link>
              )}
              <Link
                href="/support"
                onClick={() => setIsMobileMenuOpen(false)}
                className={mobileLinkClass(isSupportActive)}
                aria-current={isSupportActive ? "page" : undefined}
              >
                Support
              </Link>
            </div>

            {/* Community Management Section */}
            {hasManagementLinks && (
              <div className="space-y-1 pt-3 border-t border-border">
                <div className="text-sm leading-5 font-semibold text-text-muted px-3 py-1">
                  Community Management
                </div>
                {isDelegate && (
                  <>
                    <Link
                      href="/communities/irm/membership/review"
                      onClick={() => setIsMobileMenuOpen(false)}
                      className={mobileLinkClass(isReviewActive)}
                      aria-current={isReviewActive ? "page" : undefined}
                    >
                      Review Applications
                    </Link>
                    <Link
                      href="/communities/irm/membership/staff"
                      onClick={() => setIsMobileMenuOpen(false)}
                      className={mobileLinkClass(isStaffActive)}
                      aria-current={isStaffActive ? "page" : undefined}
                    >
                      Manage Staff
                    </Link>
                  </>
                )}
                {canManageVoting && (
                  <Link
                    href="/communities/irm/document-voting/settings"
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={mobileLinkClass(isVotingSettingsActive)}
                    aria-current={isVotingSettingsActive ? "page" : undefined}
                  >
                    Voting Settings
                  </Link>
                )}
              </div>
            )}

            {/* Account Controls Section */}
            <div className="pt-3 border-t border-border space-y-2">
              <div className="text-sm leading-5 font-semibold text-text-muted px-3 py-1">
                Account
              </div>
              {isLoading ? (
                <div className="px-3 py-2 text-sm text-text-muted">Loading session...</div>
              ) : user ? (
                <div className="p-3 bg-surface-secondary rounded-control space-y-3">
                  <div className="flex flex-col items-start gap-1 min-w-0">
                    <span
                      className="font-semibold text-text text-base leading-6 [overflow-wrap:anywhere] max-w-full"
                      title={user.username}
                    >
                      {user.username}
                    </span>
                    {isRefreshing && !membership ? (
                      <span className="text-sm leading-5 text-text-muted [overflow-wrap:anywhere]">Checking membership…</span>
                    ) : membershipError ? (
                      <span className="text-sm leading-5 text-text-muted [overflow-wrap:anywhere]">Membership unavailable</span>
                    ) : membership ? (
                      <span className="text-sm leading-5 text-text-muted [overflow-wrap:anywhere]">
                        {membership.status} {membership.role}
                      </span>
                    ) : (
                      <span className="text-sm text-text-muted">No membership</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleLogout}
                    disabled={isLoggingOut}
                    className={buttonStyles("secondary", "w-full")}
                  >
                    {isLoggingOut ? "Logging out..." : "Logout"}
                  </button>
                  {logoutError && (
                    <p role="alert" className="text-sm leading-5 text-error [overflow-wrap:anywhere]">
                      {logoutError}
                    </p>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 px-1">
                  <Link
                    href="/login"
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={buttonStyles("secondary")}
                  >
                    Log In
                  </Link>
                  <Link
                    href="/register"
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={buttonStyles("primary")}
                  >
                    Register
                  </Link>
                </div>
              )}
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
