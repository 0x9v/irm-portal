import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./DocumentRow.module.css";

type DocumentRowProps = {
  title: string;
  openHref?: string;
  context?: ReactNode;
  metadata: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
};

/** Presentation only: each list owns its data, access checks and actions. */
export default function DocumentRow({ title, openHref, context, metadata, status, actions }: DocumentRowProps) {
  return <article className={styles.row}>
    <div className={styles.header}>
      <div className={styles.copy}>
        <h3 className={styles.title}>
          {openHref ? <Link className={`ui-nav-link ${styles.titleLink}`} href={openHref}>{title}</Link> : title}
        </h3>
        {context && <div className={styles.context}>{context}</div>}
      </div>
      {status && <div className={styles.status}>{status}</div>}
    </div>
    <div className={styles.metadata}>{metadata}</div>
    {actions && <div className={styles.actions}>{actions}</div>}
  </article>;
}
