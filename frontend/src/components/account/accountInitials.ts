export function accountInitials(username: string): string {
  return username.trim().split(/[\s_.-]+/).filter(Boolean).slice(0, 2)
    .map(part => Array.from(part)[0]).join("").toUpperCase() || "E";
}
