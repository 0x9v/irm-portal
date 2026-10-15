"use client";

import { useRef, useState, useCallback, type ReactNode } from "react";
import Link from "next/link";
import { buttonStyles } from "@/components/ui/Button";
import { usePathname } from "next/navigation";
import useNavigationDisclosure from "@/components/navigation/useNavigationDisclosure";
import GuestBrandMark from "./GuestBrandMark";
import ThemeSelector, { SystemAppearanceAction } from "@/components/navigation/ThemeSelector";
import { IconHome, IconSupport, IconLogout, IconMembership, IconMenu, IconClose } from "@/components/navigation/NavIcons";
import styles from "./GuestHome.module.css";

const destinations = [
  { href: "/", label: "Home", Icon: IconHome },
  { href: "/login", label: "Sign in", Icon: IconLogout },
  { href: "/register", label: "Create an account", Icon: IconMembership },
  { href: "/support", label: "Support", Icon: IconSupport },
];

/** Public-route shell; authentication links wait for a confirmed guest session. */
export default function GuestHomeShell({ children, confirmed }: { children: ReactNode; confirmed: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const header = useRef<HTMLElement>(null);
  const pathname = usePathname();
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useNavigationDisclosure(menuOpen, closeMenu, header, menuButton);

  const brand = (
    <Link href="/" className={`ui-nav-link ${styles.shellBrand}`} aria-label="EtudSup Home">
      <GuestBrandMark /><span><strong>EtudSup</strong><small>IRM · FST Mohammedia</small></span>
    </Link>
  );
  const navigation = (label: string) => (
    <nav aria-label={label} className={styles.links}>
      {destinations.filter(({ href }) => confirmed || href === "/" || href === "/support").map(({ href, label, Icon }) => (
        <Link key={href} href={href} prefetch={false} className="ui-nav-link" aria-current={href === pathname ? "page" : undefined} onClick={() => setMenuOpen(false)}>
          <Icon /><span>{label}</span>
        </Link>
      ))}
    </nav>
  );

  return (
    <div data-application-shell data-guest-home-shell className={styles.shell}>
      {confirmed && pathname === "/" && <a href="#guest-home-heading" className={styles.skipLink}>Skip to welcome</a>}
      <aside className={`${styles.sidebar} ${styles.inkControls}`}>
        {brand}
        <div><p className={styles.navLabel}>YOUR STARTING POINT</p>{navigation("Guest navigation")}</div>
        <div className={styles.sidebarFooter}>
          <p>Study resources and the IRM student community, in one place.</p>
          <div className={styles.appearanceControls}><ThemeSelector /><SystemAppearanceAction /></div>
        </div>
      </aside>
      <div className={styles.workspace}>
        <header ref={header} className={`${styles.mobileHeader} ${styles.inkControls}`}>
          <div className={styles.headerRow}>
            {brand}
            <button ref={menuButton} type="button" className={buttonStyles("secondary", styles.menuButton)} aria-expanded={menuOpen} aria-controls="guest-home-navigation" onClick={() => setMenuOpen(open => !open)}>
              {menuOpen ? <IconClose /> : <IconMenu />}<span>{menuOpen ? "Close" : "Menu"}</span>
            </button>
          </div>
          {menuOpen && <button type="button" tabIndex={-1} aria-label="Dismiss navigation" className={styles.backdrop} onClick={() => { closeMenu(); menuButton.current?.focus(); }} />}
          <div id="guest-home-navigation" className={styles.mobileMenu} hidden={!menuOpen}>
            {navigation("Guest mobile navigation")}
            <div className={styles.appearanceControls}><ThemeSelector /><SystemAppearanceAction /></div>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
