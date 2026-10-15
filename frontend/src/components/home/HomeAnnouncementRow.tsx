import Link from "next/link";
import { IconAnnouncements } from "@/components/navigation/NavIcons";
import type { AnnouncementCardData } from "@/components/AnnouncementCard";

import styles from "./HomeDashboard.module.css";

interface HomeAnnouncementRowProps {
  announcement: AnnouncementCardData;
  communitySlug?: string;
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

export default function HomeAnnouncementRow({
  announcement,
  communitySlug = "irm",
}: HomeAnnouncementRowProps) {
  const detailHref = `/communities/${communitySlug}/announcements/${announcement.id}`;
  const excerpt = getExcerpt(announcement.content);
  const formattedDate = formatDate(announcement.created_at);

  return (
    <Link
      href={detailHref}
      prefetch={false}
      aria-label={`Announcement: ${announcement.title}`}
      className={`ui-card-link ${styles.announcementRow}`}
    >
      <article>
        <div className={styles.announcementIcon}><IconAnnouncements className="w-4 h-4" /></div>
        <div className={styles.announcementContent}>
          <div className={styles.announcementMetadata}>
            <time dateTime={announcement.created_at}>{formattedDate}</time>
            {announcement.author_username && <span className={styles.announcementAuthor}>By {announcement.author_username}</span>}
          </div>
          <h3>{announcement.title}</h3>
          <p>{excerpt}</p>
        </div>
        <span className={styles.chevron} aria-hidden="true">›</span>
      </article>
    </Link>
  );
}
