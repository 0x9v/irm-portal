import type { MembershipRole } from "@/context/AuthContext";

export type DirectoryStatus = "ACTIVE" | "PENDING" | "REJECTED" | "REMOVED" | "BANNED";
export type DirectoryFilter = DirectoryStatus | "ALL";

export interface MembershipDirectoryItem {
  id: string;
  username: string;
  status: DirectoryStatus;
  role: MembershipRole;
  created_at: string;
  updated_at: string;
}

export interface MembershipDirectoryResponse {
  items: MembershipDirectoryItem[];
  next_cursor: string | null;
}
