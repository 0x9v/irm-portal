"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { fetchApi } from "@/lib/api";
import FeedbackMessage from "@/components/FeedbackMessage";
import { ContentLoading, ContentEmpty } from "@/components/ContentState";
import { IconModules } from "@/components/navigation/NavIcons";
import styles from "./ModuleBrowser.module.css";

export type ModuleResponse = {
  id: string; community_id: string; name: string; slug: string;
  created_at: string; updated_at: string;
};

/** Both module URLs share the same real chooser; the index has no default selection. */
export default function ModuleBrowserFrame({ selectedSlug, children }: { selectedSlug?: string; children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const [modules, setModules] = useState<ModuleResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setModules([]); setError(null); setLoading(true);
    if (!user || isLoading) return () => controller.abort();
    fetchApi<ModuleResponse[]>("/api/v1/communities/irm/modules", { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setModules(data); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "An unexpected error occurred."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [user?.id, user, isLoading, retry]);

  const choices = <>
    {loading ? <ContentLoading label="Loading modules…" kind="module" count={2} />
      : error ? <FeedbackMessage type="error" message="Modules could not be loaded. Please try again." onRetry={() => setRetry(value => value + 1)} retryLabel="Retry Loading" />
      : modules.length === 0 ? <ContentEmpty title="No modules found." description="IRM modules will appear here when they are available." />
      : <nav aria-label="Module choices" className={styles.choices}>
        {modules.map(mod => <Link key={mod.id} prefetch={false} href={`/communities/irm/modules/${encodeURIComponent(mod.slug)}`}
          aria-current={selectedSlug === mod.slug ? "page" : undefined} className={`ui-nav-link ${styles.choice}`}>
          <span className={styles.moduleIcon}><IconModules /></span><span>{mod.name}</span>
        </Link>)}
      </nav>}
  </>;
  return <div className={styles.workspace}>
    <aside className={styles.chooser} aria-label="Modules">
      <h2 className={styles.chooserHeading}>Modules</h2>
      <div className={styles.desktopChoices}>{choices}</div>
      <details className={styles.mobileChoices} key={selectedSlug ?? "index"} open={!selectedSlug}>
        <summary>{selectedSlug ? "Change module" : "Choose a module"}</summary>
        {choices}
      </details>
    </aside>
    <section className={styles.documents} aria-label="Module documents">{children}</section>
  </div>;
}
