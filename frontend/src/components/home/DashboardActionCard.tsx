import Link from "next/link";
import { buttonStyles } from "@/components/ui/Button";
import { ReactNode } from "react";
import styles from "./HomeDashboard.module.css";

interface DashboardActionCardProps {
  title: string;
  description: string;
  action: string;
  href: string;
  icon: ReactNode;
  primary?: boolean;
  className?: string;
}

export default function DashboardActionCard({ title, description, action, href, icon, primary = false, className = "" }: DashboardActionCardProps) {
  return (
    <section className={`${styles.featureCard} ${className}`}>
      <Link href={href} prefetch={false} aria-label={`${title}: ${action}`} className={`ui-card-link ${styles.featureCardLink}`}>
        <div className={styles.iconTile}>{icon}</div>
        <h2>{title}</h2>
        <p>{description}</p>
        <span className={buttonStyles(primary ? "primary" : "secondary", styles.cardAction)}>
          {action}<span aria-hidden="true">→</span>
        </span>
      </Link>
    </section>
  );
}
