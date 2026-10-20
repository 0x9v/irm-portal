import { isDocumentType, type DocumentTypeValue } from "@/lib/documentPresentation";

export type ResourceKind = "PDF" | "IMAGE" | "YOUTUBE" | "LINK";
export type ResourceSource = "STUDENT" | "OFFICIAL";

export const MAX_RESOURCE_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_RESOURCE_PDF_BYTES = 50 * 1024 * 1024;

export interface ResourceDraft {
  kind: ResourceKind;
  title: string;
  description: string;
  source: ResourceSource;
  category: DocumentTypeValue | "";
  file: File | null;
  url: string;
}

export interface ResourceCreated {
  id: string;
  module_id: string;
  kind: ResourceKind;
  title: string;
  source: ResourceSource;
  status: "PENDING" | "APPROVED" | "REJECTED";
  category: DocumentTypeValue;
  document_type?: string;
  preview_url?: string;
  video_id?: string;
  url?: string;
}

export function fileError(kind: "PDF" | "IMAGE", file: File): string | null {
  if (file.size === 0) return "Choose a nonempty file.";
  if (kind === "PDF") {
    if (file.type !== "application/pdf") return "Choose a PDF file.";
    if (file.size > MAX_RESOURCE_PDF_BYTES) return "PDF files must be 50 MiB or smaller.";
  } else {
    if (file.type !== "image/jpeg" && file.type !== "image/png") return "Choose a JPEG or PNG image.";
    if (file.size > MAX_RESOURCE_IMAGE_BYTES) return "Images must be 10 MiB or smaller.";
  }
  return null;
}

export function urlError(kind: "YOUTUBE" | "LINK", value: string): string | null {
  if (!value || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) return "Enter an HTTPS URL of at most 2,048 characters.";
  let parsed: URL;
  try { parsed = new URL(value); } catch { return "Enter a valid HTTPS URL."; }
  if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password ||
      (parsed.port && parsed.port !== "443")) return "Enter an HTTPS URL without credentials or a custom port.";
  if (kind === "LINK") return null;
  const host = parsed.hostname;
  const validHost = ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(host);
  const validId = /^[A-Za-z0-9_-]{11}$/;
  let id = "";
  if (host === "youtu.be" && /^\/[A-Za-z0-9_-]{11}$/.test(parsed.pathname) && !parsed.search) id = parsed.pathname.slice(1);
  else if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host) && parsed.pathname === "/watch" &&
    [...parsed.searchParams.keys()].length === 1 && parsed.searchParams.has("v")) id = parsed.searchParams.get("v") ?? "";
  else if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host) && /^\/shorts\/[A-Za-z0-9_-]{11}$/.test(parsed.pathname) && !parsed.search) id = parsed.pathname.slice(8);
  if (!validHost || parsed.hash || !validId.test(id)) return "Use a YouTube watch, shorts, or youtu.be video URL.";
  return null;
}

export function draftError(draft: ResourceDraft): string | null {
  if (!isDocumentType(draft.category)) return "Choisir une catégorie.";
  if (!draft.title.trim() || draft.title.trim().length > 255) return "Enter a title of at most 255 characters.";
  if (draft.description.trim().length > 2000) return "Description must be 2,000 characters or shorter.";
  if (draft.kind === "PDF" || draft.kind === "IMAGE") {
    if (!draft.file) return `Choose ${draft.kind === "PDF" ? "a PDF" : "an image"} file.`;
    return fileError(draft.kind, draft.file);
  }
  return urlError(draft.kind, draft.url.trim());
}

export function submissionBody(draft: ResourceDraft): FormData | string {
  const common = { kind: draft.kind, title: draft.title.trim(), description: draft.description.trim() || null, source: draft.source };
  if (draft.kind === "PDF" || draft.kind === "IMAGE") {
    const body = new FormData();
    body.append("kind", draft.kind);
    body.append("title", common.title);
    if (common.description) body.append("description", common.description);
    body.append("source", common.source);
    body.append("type", draft.category);
    if (draft.file) body.append("file", draft.file);
    return body;
  }
  return JSON.stringify({ ...common, url: draft.url.trim(), type: draft.category });
}

export function validCreation(value: unknown, draft: ResourceDraft, moduleId: string,
  membershipRole: "MEMBER" | "MODERATOR" | "DELEGATE"): value is ResourceCreated {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ResourceCreated>;
  if (typeof item.id !== "string" || !item.id || item.module_id !== moduleId || item.kind !== draft.kind ||
      item.title !== draft.title.trim() || item.source !== draft.source ||
      item.status !== (draft.source === "OFFICIAL" || membershipRole === "DELEGATE" ? "APPROVED" : "PENDING") ||
      !isDocumentType(draft.category) || item.category !== draft.category) return false;
  if (draft.kind === "PDF") return item.document_type === draft.category;
  if (draft.kind === "IMAGE") return typeof item.preview_url === "string" && item.preview_url.startsWith("/api/v1/communities/");
  if (draft.kind === "YOUTUBE") return typeof item.video_id === "string" && /^[A-Za-z0-9_-]{11}$/.test(item.video_id) && typeof item.url === "string";
  return typeof item.url === "string";
}
