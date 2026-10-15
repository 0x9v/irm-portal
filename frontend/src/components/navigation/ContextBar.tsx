"use client";

import { iconButtonStyles } from "@/components/ui/Button";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { IconPanelLeft } from "./NavIcons";
import AccountControls from "./AccountControls";
import styles from "./NavigationShell.module.css";

interface ContextBarProps {
  isSidebarVisible: boolean;
  onToggleSidebar: () => void;
  className?: string;
}

function getContextTrail(pathname: string): string {
  if (pathname === "/") return "Home";
  if (pathname.startsWith("/communities/irm/modules")) {
    if (pathname.includes("/upload")) return "Modules / Upload Document";
    if (pathname.includes("/documents/")) return "Modules / Document Reader";
    if (pathname !== "/communities/irm/modules") return "Modules / Details";
    return "Modules";
  }
  if (pathname.startsWith("/communities/irm/documents/saved")) return "Saved Documents";
  if (pathname.startsWith("/communities/irm/documents/recent")) return "Recently Opened";
  if (pathname.startsWith("/communities/irm/documents/mine")) return "My Submissions";
  if (pathname.startsWith("/communities/irm/documents/pending")) return "Pending Document Reviews";
  if (pathname.startsWith("/communities/irm/announcements")) {
    if (pathname !== "/communities/irm/announcements") return "Announcements / Notice";
    return "Announcements";
  }
  if (pathname.startsWith("/communities/irm/posts")) {
    if (pathname.includes("/new")) return "Student Posts / New Question";
    if (pathname !== "/communities/irm/posts") return "Student Posts / Discussion";
    return "Posts";
  }
  if (pathname.startsWith("/communities/irm/discussion")) return "Discussion";
  if (pathname.startsWith("/communities/irm/membership/review")) return "Membership / Application Reviews";
  if (pathname.startsWith("/communities/irm/membership/staff")) return "Leadership / Manage Staff";
  if (pathname.startsWith("/communities/irm/membership/members")) return "Leadership / Members";
  if (pathname.startsWith("/communities/irm/membership")) return "Membership";
  if (pathname.startsWith("/communities/irm/document-voting/settings")) return "Settings / Document Voting";
  if (pathname.startsWith("/support")) return "Support";
  if (pathname.startsWith("/login")) return "Authentication / Sign In";
  if (pathname.startsWith("/register")) return "Authentication / Register";
  return "EtudSup";
}

export default function ContextBar({
  isSidebarVisible,
  onToggleSidebar,
  className = "",
}: ContextBarProps) {
  const pathname = usePathname();
  const trail = getContextTrail(pathname);
  const [accountOpen, setAccountOpen] = useState(false);

  return (
    <div
      role="region"
      aria-label="Context Bar"
      className={`${styles.contextBar} ${className || "flex"}`}
    >
      <div className={styles.contextLeft}>
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-expanded={isSidebarVisible}
          aria-label={isSidebarVisible ? "Hide navigation" : "Show navigation"}
          aria-controls="desktop-navigation"
          className={iconButtonStyles()}
        >
          <IconPanelLeft className="w-[18px] h-[18px]" />
        </button>

        <div className={styles.contextTrail} title={`IRM / ${trail}`}>
          <span>IRM <span aria-hidden="true">/</span></span> {trail}
        </div>
      </div>
      <AccountControls open={accountOpen} onOpenChange={setAccountOpen} />
    </div>
  );
}
