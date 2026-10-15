import type { ReactNode } from "react";
import styles from "./ContentState.module.css";

type LoadingKind = "document" | "announcement" | "module";

export function ContentLoading({ label, kind, count = 2 }: { label: string; kind: LoadingKind; count?: number }) {
  return <div className={styles.loading}>
    <p role="status" className={styles.loadingLabel}>{label}</p>
    <div aria-hidden="true" className={styles.stack}>
      {Array.from({ length: count }, (_, index) => <div key={index} className={`${styles.skeleton} ${styles[kind]}`}>
        <span className={styles.shortLine} />
        <span className={styles.longLine} />
        <span className={styles.mediumLine} />
      </div>)}
    </div>
  </div>;
}

export function ContentEmpty({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className={styles.empty}>
    <span className={styles.emptyIcon} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 5.5h16v13H4zM8 9h8M8 13h6" />
      </svg>
    </span>
    <h3 className={styles.emptyTitle}>{title}</h3>
    <p className={styles.emptyDescription}>{description}</p>
    {action && <div className={styles.emptyAction}>{action}</div>}
  </div>;
}
