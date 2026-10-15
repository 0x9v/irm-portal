"use client";

import { ReactNode, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import GuestHomeShell from "@/components/home/GuestHomeShell";
import SidebarNav from "@/components/navigation/SidebarNav";
import ContextBar from "@/components/navigation/ContextBar";
import MobileHeader from "@/components/navigation/MobileHeader";
import MobileBottomNav from "@/components/navigation/MobileBottomNav";
import SiteFooter from "./SiteFooter";
import identity from "./FeatureIdentity.module.css";
import styles from "@/components/navigation/MobileShell.module.css";

interface ApplicationShellProps {
  children: ReactNode;
  copyrightYear: number;
}

export default function ApplicationShell({ children, copyrightYear }: ApplicationShellProps) {
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);
  const pathname = usePathname();
  const { user, isLoading, isRefreshing, isLoggingOut, error } = useAuth();
  // Reader and conversation routes retain their constrained reading/composer space.
  const constrained = pathname === "/communities/irm/discussion" ||
    pathname.startsWith("/communities/irm/discussion/") ||
    /^\/communities\/irm\/modules\/[^/]+\/documents\/[^/]+(?:\/|$)/.test(pathname);
  const footer = constrained ? null : <SiteFooter year={copyrightYear} />;

  // Home owns its public landing header. Loading and error stay neutral here.
  if (pathname === "/" && !user) {
    return <div data-application-shell data-public-home-frame className="min-h-screen flex flex-col">{children}{footer}</div>;
  }

  // Account routes own a focused public layout and their own auth-state gate.
  if (pathname === "/login" || pathname === "/register") {
    return <div data-application-shell data-public-account-frame className="min-h-screen flex flex-col">{children}{footer}</div>;
  }

  // Keep a previous identity out of the account route while its session is unresolved.
  if (pathname === "/account" && (isRefreshing || isLoggingOut || error)) {
    return <GuestHomeShell confirmed={false}>
      <div className={`${identity.feature} flex flex-col`} data-feature-identity>{children}{footer}</div>
    </GuestHomeShell>;
  }

  // Public navigation remains short until an authenticated account is established.
  // Pending/error checks keep public help available without authentication actions.
  if (!user || isLoading) {
    return (
      <GuestHomeShell confirmed={!isLoading && !isRefreshing && !isLoggingOut && !error}>
        <div className={`${identity.feature} flex flex-col`} data-feature-identity>{children}{footer}</div>
      </GuestHomeShell>
    );
  }

  return (
    <div data-application-shell className="min-h-screen bg-page text-text flex flex-col xl:flex-row">
      {/* Mobile/Tablet Header & Disclosure (< 1280px) */}
      <MobileHeader />

      {/* Desktop Left Sidebar (>= 1280px) */}
      {isSidebarVisible && (
        <SidebarNav />
      )}

      {/* Main Workspace Area Beside Sidebar */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Desktop Context Bar (>= 1280px) */}
        <ContextBar
          isSidebarVisible={isSidebarVisible}
          onToggleSidebar={() => setIsSidebarVisible((prev) => !prev)}
          className="hidden xl:flex"
        />

        {/* Route Content Area (No <main> landmark here; preserved on individual page containers) */}
        <div data-feature-identity={pathname !== "/" ? "" : undefined} className={`flex-1 min-w-0 flex flex-col ${styles.workspace} ${pathname === "/" ? "" : identity.feature}`}>
          {children}
          {footer}
        </div>
      </div>
      <MobileBottomNav />
    </div>
  );
}
