"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, SVGProps } from "react";
import { useAuth, type AuthContextValue } from "@/context/AuthContext";
import {
  IconHome, IconModules, IconSaved, IconRecent, IconSubmissions,
  IconPendingDocs, IconAnnouncements, IconPosts, IconDiscussion,
  IconReview, IconStaff, IconMembers, IconSettings,
} from "./NavIcons";
import styles from "./NavigationShell.module.css";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;
type Item = { href: string; label: string; Icon: Icon };
type Group = { label: string; items: Item[] };
const irm = "/communities/irm";

export function navigationGroups(context: Pick<AuthContextValue,
  "user" | "membership" | "membershipError" | "error" | "isLoading" | "isRefreshing" | "isLoggingOut" | "capabilities">): Group[] {
  const verified = !!context.user && !context.isLoading &&
    !context.isLoggingOut && !context.error && !context.membershipError;
  const active = verified && context.membership?.status === "ACTIVE";
  const delegate = active && !context.isRefreshing && context.membership?.role === "DELEGATE";
  const voting = active && !context.isRefreshing && Boolean(context.capabilities?.manage_document_voting);
  const groups: Group[] = [
    { label: "Workspace", items: [{ href: "/", label: "Home", Icon: IconHome }] },
    { label: "Study", items: [
      { href: `${irm}/modules`, label: "Modules", Icon: IconModules },
      ...(active ? [{ href: `${irm}/documents/pending`, label: "Pending documents", Icon: IconPendingDocs }] : []),
    ] },
    ...(active ? [{ label: "IRM community", items: [
        { href: `${irm}/announcements`, label: "Announcements", Icon: IconAnnouncements },
        { href: `${irm}/posts`, label: "Posts", Icon: IconPosts },
        { href: `${irm}/discussion`, label: "Discussion", Icon: IconDiscussion },
    ] }] : []),
    { label: "Your library", items: [
      { href: `${irm}/documents/saved`, label: "Saved documents", Icon: IconSaved },
      { href: `${irm}/documents/recent`, label: "Recently opened", Icon: IconRecent },
      ...(active ? [{ href: `${irm}/documents/mine`, label: "My submissions", Icon: IconSubmissions }] : []),
    ] },
  ];
  const management: Item[] = [
    ...(delegate ? [
      { href: `${irm}/membership/review`, label: "Review applications", Icon: IconReview },
      { href: `${irm}/membership/staff`, label: "Manage staff", Icon: IconStaff },
      { href: `${irm}/membership/members`, label: "Members", Icon: IconMembers },
    ] : []),
    ...(voting ? [{ href: `${irm}/document-voting/settings`, label: "Voting settings", Icon: IconSettings }] : []),
  ];
  if (management.length) groups.push({ label: "Management", items: management });
  return groups;
}

export function navigationIsActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function NavigationLinks({ mobile = false, onNavigate }: { mobile?: boolean; onNavigate?: () => void }) {
  const context = useAuth();
  const pathname = usePathname();
  return (
    <nav aria-label={mobile ? "Mobile Navigation" : "Main Navigation"} className={styles.navigation}>
      {navigationGroups(context).map(group => (
        <div key={group.label} className={styles.navGroup}>
          <p className={styles.groupLabel}>{group.label}</p>
          <div className={styles.groupItems}>
            {group.items.map(({ href, label, Icon }) => {
              const active = navigationIsActive(pathname, href);
              return (
                <Link key={href} href={href} prefetch={false} onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={`ui-nav-link ${styles.navLink} ${active ? styles.activeLink : ""}`}>
                  <Icon className={styles.navIcon} />
                  <span>{label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
