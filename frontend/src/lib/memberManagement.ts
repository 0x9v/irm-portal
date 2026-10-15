import type { MembershipDirectoryItem } from "@/types/membershipDirectory";

// Unknown statuses and leadership fail closed. Backend authorization remains authoritative.
export function memberActions(member: Pick<MembershipDirectoryItem, "status" | "role">): ("member" | "ban" | "unban")[] {
  if (member.role !== "MEMBER" && member.role !== "MODERATOR") return [];
  if (member.status === "BANNED") return ["unban"];
  if (member.status === "REMOVED") return ["ban"];
  if (["ACTIVE", "PENDING", "REJECTED"].includes(member.status)) return ["member", "ban"];
  return [];
}
