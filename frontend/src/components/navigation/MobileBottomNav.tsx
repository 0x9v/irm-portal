"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { IconHome, IconModules, IconPosts, IconDiscussion, IconMembership } from "./NavIcons";
import styles from "./MobileShell.module.css";

export default function MobileBottomNav() {
  const { user, membership, membershipError, error, isLoading, isLoggingOut, isRefreshing } = useAuth();
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const activeMember = !isLoading && !isRefreshing && !isLoggingOut && !!user && !membershipError && !error && membership?.status === "ACTIVE";
  const restricted = membership && !["ACTIVE", "PENDING", "REJECTED", "REMOVED"].includes(membership.status);
  const guidance = restricted ? "/support" : "/account#community-membership";
  const links = [
    { href: "/", label: "Home", Icon: IconHome },
    { href: "/communities/irm/modules", label: "Modules", Icon: IconModules },
    { href: "/communities/irm/posts", label: "Posts", Icon: IconPosts },
    { href: "/communities/irm/discussion", label: "Discussion", Icon: IconDiscussion },
    { href: "/account", label: "Account", Icon: IconMembership },
  ];

  // Measure the actual bar, including wrapped/enlarged labels and safe-area padding.
  // Retain the last height while editing so hiding the bar does not shift the page.
  useEffect(() => {
    const nav = navRef.current;
    const shell = nav?.closest<HTMLElement>("[data-application-shell]");
    if (!nav || !shell || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const height = Math.ceil(nav.getBoundingClientRect().height);
      if (height > 0) shell.style.setProperty("--mobile-navigation-height", `${height}px`);
    });
    observer.observe(nav);
    return () => {
      observer.disconnect();
      shell.style.removeProperty("--mobile-navigation-height");
    };
  }, []);

  if (!user || isLoading) return null;
  return (
    <nav ref={navRef} aria-label="Mobile bottom navigation" className={styles.bottomNav}>
      <div className={styles.bottomLinks}>
        {links.map(({ href, label, Icon }) => {
          const current = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
          const needsGuidance = !activeMember && (label === "Posts" || label === "Discussion");
          return (
            <Link key={label} href={needsGuidance ? guidance : href} prefetch={false}
              aria-label={needsGuidance ? `${label}: ${guidance === "/support" ? "contact Support" : "check IRM membership access"}` : label}
              aria-current={current ? "page" : undefined} className={`ui-nav-link ${styles.bottomLink}`}>
              <span className={styles.bottomIcon}><Icon /></span>
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
