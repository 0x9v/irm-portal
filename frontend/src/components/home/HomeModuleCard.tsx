import Link from "next/link";
import { IconModules } from "@/components/navigation/NavIcons";
import type { ModuleResponse } from "@/app/communities/irm/modules/page";

import styles from "./HomeDashboard.module.css";

interface HomeModuleCardProps {
  module: ModuleResponse;
}

export default function HomeModuleCard({ module }: HomeModuleCardProps) {
  return (
    <Link
      href={`/communities/irm/modules/${module.slug}`}
      aria-label={`Module: ${module.name}`}
      className={`ui-card-link ${styles.moduleCard}`}
    >
      <div className={styles.moduleTop}>
        <div className={styles.moduleIcon}>
          <IconModules className="w-5 h-5" />
        </div>
        <span
          className="text-text-subtle text-sm shrink-0"
          aria-hidden="true"
        >
          &rarr;
        </span>
      </div>
      <h3>
        {module.name}
      </h3>
      <p>
        Open module resources
      </p>
    </Link>
  );
}
