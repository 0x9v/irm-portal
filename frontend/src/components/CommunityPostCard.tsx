import Link from "next/link";
import { CommunityPostFeedItem } from "@/types/posts";

interface CommunityPostCardProps {
  post: CommunityPostFeedItem;
  onSelectModule?: (moduleId: string) => void;
}

export default function CommunityPostCard({
  post,
  onSelectModule,
}: CommunityPostCardProps) {
  const formattedDate = (() => {
    try {
      return new Date(post.created_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return post.created_at;
    }
  })();

  return (
    <article className="p-5 bg-surface border border-border rounded-surface shadow-none hover:border-control-border transition-colors space-y-3">
      {/* Header: Title and Author attribution */}
      <div>
        <h3 className="text-lg font-semibold text-text tracking-tight break-words">
          <Link
            href={`/communities/irm/posts/${post.id}`}
            className="ui-nav-link hover:text-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2 rounded transition-colors"
          >
            {post.title}
          </Link>
        </h3>
        <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-text-subtle">
          <span className="font-medium text-text">@{post.author_username}</span>
          <span aria-hidden="true">&bull;</span>
          <time dateTime={post.created_at}>{formattedDate}</time>
        </div>
      </div>

      {/* Excerpt */}
      <p className="text-sm text-text-muted line-clamp-3 break-words [overflow-wrap:anywhere]">
        {post.excerpt}
      </p>

      {/* Module tags */}
      {post.modules && post.modules.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1" aria-label="Tagged modules">
          {post.modules.map((mod) => (
            <Link
              key={mod.id}
              href={`/communities/irm/posts?module_id=${mod.id}`}
              onClick={(e) => {
                if (onSelectModule) {
                  e.preventDefault();
                  onSelectModule(mod.id);
                }
              }}
              className="ui-button ui-button--quiet"
            >
              {mod.name}
            </Link>
          ))}
        </div>
      )}
    </article>
  );
}
