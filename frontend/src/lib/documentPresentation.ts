export const DOCUMENT_TYPES = ["COURSE", "TD", "TP", "EXAM", "SOLUTION", "OTHER"] as const;
export const DOCUMENT_SOURCES = ["OFFICIAL", "STUDENT"] as const;

export type DocumentTypeValue = (typeof DOCUMENT_TYPES)[number];
export type DocumentSourceValue = (typeof DOCUMENT_SOURCES)[number];

const typeLabels: Record<DocumentTypeValue, string> = {
  COURSE: "Cours",
  TD: "TD",
  TP: "TP",
  EXAM: "Examen",
  SOLUTION: "Solution",
  OTHER: "Autre",
};

export const DOCUMENT_CATEGORY_OPTIONS = DOCUMENT_TYPES.map(value => ({ value, label: typeLabels[value] }));

const sourceLabels: Record<DocumentSourceValue, string> = {
  OFFICIAL: "Official",
  STUDENT: "Student submission",
};

export function isDocumentType(value: string | null | undefined): value is DocumentTypeValue {
  return DOCUMENT_TYPES.some((item) => item === value);
}

export function isDocumentSource(value: string | null | undefined): value is DocumentSourceValue {
  return DOCUMENT_SOURCES.some((item) => item === value);
}

export function documentTypeLabel(value: string): string {
  return isDocumentType(value) ? typeLabels[value] : value;
}

export function documentSourceLabel(value: string): string {
  return isDocumentSource(value) ? sourceLabels[value] : value;
}

export function documentStatusLabel(value: string): string {
  switch (value) {
    case "PENDING": return "Awaiting review";
    case "APPROVED": return "Approved";
    case "REJECTED": return "Not approved";
    default: return value;
  }
}

export type DocumentReturnContext = "module" | "mine" | "pending";

export function isDocumentReturnContext(value: string | null | undefined): value is DocumentReturnContext {
  return value === "module" || value === "mine" || value === "pending";
}

export type ModuleDocumentFilters = { q: string; type: string; source: string; category?: string };

export function readModuleDocumentFilters(search: string): ModuleDocumentFilters {
  const params = new URLSearchParams(search);
  const q = (params.get("q") ?? "").trim();
  return {
    q: q.length <= 100 ? q : "",
    type: isDocumentType(params.get("type")) ? params.get("type")! : "",
    category: isDocumentType(params.get("category")) ? params.get("category")! : "",
    source: isDocumentSource(params.get("source")) ? params.get("source")! : "",
  };
}

export function moduleDocumentHref(
  moduleSlug: string,
  filters: ModuleDocumentFilters = { q: "", type: "", source: "" },
  from?: DocumentReturnContext,
  kind?: "PDF",
): string {
  const params = new URLSearchParams();
  const q = filters.q.trim();
  if (q && q.length <= 100) params.set("q", q);
  if (isDocumentType(filters.category)) params.set("category", filters.category);
  if (kind === "PDF") params.set("kind", "PDF");
  if (!isDocumentType(filters.category) && isDocumentType(filters.type)) params.set("type", filters.type);
  if (isDocumentSource(filters.source)) params.set("source", filters.source);
  if (from) params.set("from", from);
  const suffix = params.size ? `?${params.toString()}` : "";
  return `/communities/irm/modules/${encodeURIComponent(moduleSlug)}${suffix}`;
}
