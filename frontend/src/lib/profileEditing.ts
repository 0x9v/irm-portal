import type { User } from "@/context/AuthContext";
import { ApiError } from "./api";

export type ProfileFields = Pick<User, "username" | "first_name" | "family_name">;
export type ProfileField = keyof ProfileFields;
export type ProfileErrors = Partial<Record<ProfileField, string>>;

const fields: ProfileField[] = ["username", "first_name", "family_name"];
const forbidden = /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}\u202A-\u202E\u2066-\u2069]/u;

export function profileFields(user: User): ProfileFields {
  return { username: user.username, first_name: user.first_name, family_name: user.family_name };
}

// The backend rejects raw controls first, then strips Unicode boundary spaces.
export function trimProfileText(value: string): string {
  return value.replace(/^\p{Zs}+|\p{Zs}+$/gu, "");
}

export function profileChanges(draft: ProfileFields, baseline: ProfileFields): Partial<ProfileFields> {
  const changes: Partial<ProfileFields> = {};
  for (const field of fields) {
    if (draft[field] !== baseline[field] && (forbidden.test(draft[field]) || trimProfileText(draft[field]) !== baseline[field])) {
      changes[field] = trimProfileText(draft[field]);
    }
  }
  return changes;
}

export function validateProfileChanges(draft: ProfileFields, baseline: ProfileFields): ProfileErrors {
  const errors: ProfileErrors = {};
  const changes = profileChanges(draft, baseline);
  for (const field of fields) {
    if (changes[field] === undefined) continue;
    if (forbidden.test(draft[field])) {
      errors[field] = "Remove control characters, line breaks and direction controls.";
      continue;
    }
    const length = Array.from(changes[field]).length;
    const minimum = field === "username" ? 3 : 1;
    const maximum = field === "username" ? 50 : 100;
    if (length < minimum || length > maximum) {
      errors[field] = field === "username"
        ? "Use 3 to 50 characters for your username."
        : "Use 1 to 100 characters for this name.";
    }
  }
  return errors;
}

export function profileServerErrors(error: ApiError): ProfileErrors {
  const errors: ProfileErrors = {};
  if (error.status !== 422 || !Array.isArray(error.details)) return errors;
  for (const item of error.details) {
    if (!item || typeof item !== "object" || !Array.isArray(item.loc)) continue;
    const field: unknown = item.loc.at(-1);
    if (field === "username" || field === "first_name" || field === "family_name") {
      errors[field] = field === "username"
        ? "Use 3 to 50 characters and remove unsupported controls."
        : "Use 1 to 100 characters and remove unsupported controls.";
    }
  }
  return errors;
}
