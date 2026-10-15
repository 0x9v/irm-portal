"use client";

import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import AccessDeniedGuidance from "@/components/AccessDeniedGuidance";
import PageContainer from "@/components/PageContainer";
import Breadcrumbs from "@/components/Breadcrumbs";
import ModuleBrowserFrame from "@/components/modules/ModuleBrowserFrame";
import styles from "@/components/modules/ModuleBrowser.module.css";
import { buttonStyles } from "@/components/ui/Button";
export type { ModuleResponse } from "@/components/modules/ModuleBrowserFrame";

export default function ModulesPage() {
  const { user, isLoading } = useAuth();
  return <PageContainer width="wide">
    <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Modules" }]} />
    <div className="mb-6 flex flex-wrap justify-between items-center gap-4">
      <div>
        <p className="ui-eyebrow">IRM / Study resources</p>
        <h1 className="ui-page-heading text-text tracking-tight">IRM Modules</h1>
        <p className="ui-helper mt-2">Browse study resources organized by course module.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {user && <Link href="/communities/irm/documents/recent" className={buttonStyles("secondary")}>Recently Opened</Link>}
        <Link href="/" className={buttonStyles("quiet")}>← Back to Home</Link>
      </div>
    </div>
    {isLoading ? <p role="status" className="ui-helper">Loading modules...</p>
      : !user ? <AccessDeniedGuidance isGuest returnHref="/" returnLabel="Home" />
      : <ModuleBrowserFrame>
        <div className={styles.guidance}>
          <p className="ui-eyebrow">Module documents</p>
          <h2>Choose a module to get started</h2>
          <p className="ui-helper">Select an IRM module to search and read its approved study resources.</p>
        </div>
      </ModuleBrowserFrame>}
  </PageContainer>;
}
