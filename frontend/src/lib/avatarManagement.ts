export const MAX_AVATAR_BYTES = 2_097_152;

export function avatarFileError(file: Pick<File, "size" | "type">): string | null {
  if (file.size === 0) return "Choose a nonempty JPEG or PNG image.";
  if (file.size > MAX_AVATAR_BYTES) return "Choose an image no larger than 2 MiB.";
  if (file.type !== "image/jpeg" && file.type !== "image/png") return "Choose a JPEG or PNG image.";
  return null;
}

export function isOwnedAvatarUrl(value: unknown, userId: string): value is string {
  const prefix = `/api/v1/users/${encodeURIComponent(userId)}/avatar/`;
  return typeof value === "string" && value.startsWith(prefix) &&
    /^[0-9a-fA-F-]{36}$/.test(value.slice(prefix.length));
}

export function hasAvatarResponse(value: unknown): value is { avatar_url: string | null } {
  return value !== null && typeof value === "object" && "avatar_url" in value;
}
