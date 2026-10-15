import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./Announcements.module.css";

export interface AnnouncementCardData {
  id: string;
  title: string;
  content: string;
  created_at: string;
  author_username?: string | null;
}

interface AnnouncementCardProps {
  announcement: AnnouncementCardData;
  communitySlug?: string;
  headingLevel?: "h2" | "h3";
  className?: string;
  variant?: "default" | "home" | "featured";
  action?: ReactNode;
}

function formatDate(dateString: string): string {
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return dateString;
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateString;
  }
}

function getExcerpt(content: string, maxLength = 160): string {
  if (!content) return "";
  const plainText = content.replace(/\s+/g, " ").trim();
  if (plainText.length <= maxLength) return plainText;
  return plainText.slice(0, maxLength).trimEnd() + "…";
}

export default function AnnouncementCard({
  announcement,
  communitySlug = "irm",
  headingLevel = "h3",
  className = "",
  variant = "default",
  action,
}: AnnouncementCardProps) {
  const Heading = headingLevel;
  const detailHref = `/communities/${communitySlug}/announcements/${announcement.id}`;
  const featured = variant === "featured";
  const excerpt = getExcerpt(announcement.content, featured ? 360 : 160);
  const formattedDate = formatDate(announcement.created_at);

  return (
    <article className={`${styles.card} ${featured ? styles.featured : ""} ${className}`}>
      <div className={styles.cardTop}>
        <div className={styles.metadata}>
          {featured && <span className={styles.latest}>Latest</span>}
          <time dateTime={announcement.created_at}>{formattedDate}</time>
        </div>
        {action}
      </div>
      <Link data-content-card href={detailHref} prefetch={false}
        aria-label={`Announcement: ${announcement.title}`}
        className={`ui-card-link ${styles.cardLink}`}>
        <Heading className={styles.title}>
          {announcement.title}
        </Heading>
        <p className={styles.excerpt}>
          {excerpt}
        </p>
        {announcement.author_username && <p className={styles.author}>By @{announcement.author_username}</p>}
        <span className={styles.readAction}>
          Read announcement <span aria-hidden="true">&rarr;</span>
        </span>
      </Link>
    </article>
  );
}
