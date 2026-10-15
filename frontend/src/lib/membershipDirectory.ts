import { fetchApi } from "./api";
import type { DirectoryFilter, MembershipDirectoryResponse } from "@/types/membershipDirectory";

// Cursors belong to a single community/status query. Callers reset on refresh.
export function readMembershipDirectory(slug: string, filter: DirectoryFilter, after: string | null, signal: AbortSignal) {
  const query = new URLSearchParams({ limit: "20" });
  if (filter !== "ALL") query.set("status", filter);
  if (after !== null) query.set("after", after);
  return fetchApi<MembershipDirectoryResponse>(`/api/v1/communities/${encodeURIComponent(slug)}/memberships?${query}`, { signal, cache: "no-store" });
}
