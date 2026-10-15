import { ReactNode } from "react";
import styles from "./HomeDashboard.module.css";

interface DashboardPanelProps {
  title: string;
  subtitle?: string;
  headerAction?: ReactNode;
  children: ReactNode;
  className?: string;
  ariaLabelledBy?: string;
  bare?: boolean;
}

export default function DashboardPanel({
  title,
  subtitle,
  headerAction,
  children,
  className = "",
  ariaLabelledBy,
  bare = false,
}: DashboardPanelProps) {
  return (
    <section
      aria-labelledby={ariaLabelledBy}
      className={`${bare ? styles.section : styles.panel} ${className}`}
    >
      <div className={styles.panelHeader}>
        <div className="min-w-0">
          <h2
            id={ariaLabelledBy}
            className={styles.sectionHeading}
          >
            {title}
          </h2>
          {subtitle && (
            <p className="ui-helper mt-0.5 [overflow-wrap:anywhere]">{subtitle}</p>
          )}
        </div>
        {headerAction && <div className="min-w-0 max-w-full">{headerAction}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
