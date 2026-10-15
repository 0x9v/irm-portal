"use client";

import { buttonStyles } from "@/components/ui/Button";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import GuestBrandMark from "@/components/home/GuestBrandMark";
import useNavigationDisclosure from "./useNavigationDisclosure";
import NavigationLinks from "./NavigationLinks";
import SidebarProfile from "./SidebarProfile";
import AccountControls from "./AccountControls";
import { IconMenu, IconClose } from "./NavIcons";
import styles from "./NavigationShell.module.css";

export default function MobileHeader({ className = "" }: { className?: string }) {
  const [disclosure, setDisclosure] = useState<"navigation" | "account" | null>(null);
  const isMenuOpen = disclosure === "navigation";
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const closeMenu = useCallback(() => setDisclosure(null), []);
  const changeAccount = useCallback((open: boolean) => setDisclosure(open ? "account" : null), []);
  useNavigationDisclosure(isMenuOpen, closeMenu, headerRef, menuButtonRef, true);

  useEffect(() => {
    const bar = barRef.current;
    const header = headerRef.current;
    if (!bar || !header || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      header.style.setProperty("--mobile-header-height", `${Math.ceil(bar.getBoundingClientRect().height)}px`);
    });
    observer.observe(bar);
    return () => { observer.disconnect(); header.style.removeProperty("--mobile-header-height"); };
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDisclosure(null);
  }, [pathname]);

  return (
    <header ref={headerRef} className={`${styles.mobileHeader} ${className}`}>
      <div ref={barRef} className={styles.mobileBar}>
        <div className={styles.mobileLeft}>
          <button type="button" ref={menuButtonRef} onClick={() => {
            setDisclosure(isMenuOpen ? null : "navigation");
          }}
            aria-expanded={isMenuOpen} aria-controls="mobile-navigation"
            aria-label={isMenuOpen ? "Close navigation menu" : "Open navigation menu"}
            className={buttonStyles("secondary", styles.menuButton)}>
            {isMenuOpen ? <IconClose /> : <IconMenu />}
            <span>{isMenuOpen ? "Close" : "Menu"}</span>
          </button>
          <Link href="/" onClick={closeMenu} aria-label="EtudSup Home" className={`ui-nav-link ${styles.mobileBrand}`}>
            <GuestBrandMark />
            <span><strong>EtudSup</strong><small>IRM · FST Mohammedia</small></span>
          </Link>
        </div>
        <div className={styles.mobileActions}>
          <AccountControls compact open={disclosure === "account"} onOpenChange={changeAccount} />
        </div>
      </div>
      {isMenuOpen && <button type="button" tabIndex={-1} aria-label="Dismiss navigation"
        className={`${styles.backdrop} ui-motion-backdrop`} onClick={() => { closeMenu(); menuButtonRef.current?.focus(); }} />}
      {isMenuOpen && (
        <div id="mobile-navigation" className={`${styles.drawer} ui-motion-drawer`}>
          <div className={styles.drawerCommunity}><span>Current community</span><strong>IRM</strong><small>FST Mohammedia</small></div>
          <NavigationLinks mobile onNavigate={closeMenu} />
          <SidebarProfile onNavigate={closeMenu} />
        </div>
      )}
    </header>
  );
}
