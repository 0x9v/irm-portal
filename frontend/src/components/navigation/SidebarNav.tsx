"use client";

import Link from "next/link";
import GuestBrandMark from "@/components/home/GuestBrandMark";
import NavigationLinks from "./NavigationLinks";
import SidebarProfile from "./SidebarProfile";
import styles from "./NavigationShell.module.css";

export default function SidebarNav({ className = "" }: { className?: string }) {
  return (
    <aside id="desktop-navigation" aria-label="Desktop Sidebar" className={`${styles.sidebar} ${className}`}>
      <div className={styles.sidebarTop}>
        <Link href="/" aria-label="EtudSup Home" className={`ui-nav-link ${styles.brand}`}>
          <GuestBrandMark /><span>EtudSup</span>
        </Link>
        <div className={styles.communityIdentity}>
          <span className={styles.communityMark} aria-hidden="true">I</span>
          <span><strong>IRM</strong><small>FST Mohammedia</small></span>
          <span className={styles.currentCommunity}>Current community</span>
        </div>
      </div>
      <div className={styles.sidebarScroll}><NavigationLinks /></div>
      <SidebarProfile />
    </aside>
  );
}
