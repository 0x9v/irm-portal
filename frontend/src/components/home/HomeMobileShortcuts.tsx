import Link from "next/link";
import { IconModules, IconAnnouncements, IconPosts, IconDiscussion } from "@/components/navigation/NavIcons";
import styles from "./HomeDashboard.module.css";

export default function HomeMobileShortcuts({ isEligible, guidance = { href: "/account#community-membership", label: "Check membership access" } }: { isEligible: boolean; guidance?: { href: string; label: string } }) {
  const links = [
    { href: "/communities/irm/modules", label: "Modules", Icon: IconModules },
    { href: "/communities/irm/announcements", label: "Announcements", Icon: IconAnnouncements },
    { href: "/communities/irm/posts", label: "Posts", Icon: IconPosts },
    { href: "/communities/irm/discussion", label: "Discussion", Icon: IconDiscussion },
  ];
  return (
    <nav aria-label="Home shortcuts" className={styles.mobileShortcuts}>
      {links.map(({ href, label, Icon }) => (
        <Link key={href} href={label === "Modules" || isEligible ? href : guidance.href} prefetch={false} className={`ui-card-link ${styles.mobileShortcut}`}>
          <span className={styles.iconTile}><Icon /></span>
          <span>{label}</span>
          {!isEligible && label !== "Modules" && <small className={styles.shortcutGuidance}>{guidance.label}</small>}
          <span aria-hidden="true" className={styles.shortcutArrow}>›</span>
        </Link>
      ))}
    </nav>
  );
}
