import Link from "next/link";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

export default function Breadcrumbs({ items, className = "" }: BreadcrumbsProps) {
  if (!items || items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className={`mb-4 sm:mb-6 ${className}`}>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-5 text-text-muted">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={index} className="inline-flex items-center gap-1.5 min-w-0 max-w-full">
              {index > 0 && (
                <span aria-hidden="true" className="text-text-subtle select-none shrink-0">
                  /
                </span>
              )}
              {isLast || !item.href ? (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className="font-semibold text-text [overflow-wrap:anywhere] max-w-full inline-block"
                  title={item.label}
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href}
                  className="ui-nav-link text-accent inline-flex min-h-[44px] items-center [overflow-wrap:anywhere] max-w-full"
                >
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
