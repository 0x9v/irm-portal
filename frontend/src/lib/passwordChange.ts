import { ApiError } from "./api";

export type PasswordField = "current_password" | "new_password" | "confirm_password";
export type PasswordErrors = Partial<Record<PasswordField, string>>;
export type PasswordDraft = Record<PasswordField, string>;

export function validatePasswordChange(draft: PasswordDraft): PasswordErrors {
  const errors: PasswordErrors = {};
  if (draft.current_password.length === 0) errors.current_password = "Enter your current password.";
  if (Array.from(draft.new_password).length < 8) errors.new_password = "Use at least 8 characters for your new password.";
  else if (draft.new_password === draft.current_password) errors.new_password = "Choose a different new password.";
  if (draft.confirm_password !== draft.new_password) errors.confirm_password = "The passwords do not match.";
  return errors;
}

// The backend's detail array is sanitized, but its prose is not used in the UI.
export function passwordServerErrors(error: ApiError): PasswordErrors {
  const mapped: PasswordErrors = {};
  if (error.status === 400) return { current_password: "Your current password is incorrect." };
  if (error.status !== 422 || !Array.isArray(error.details)) return mapped;
  for (const detail of error.details) {
    if (!detail || typeof detail !== "object" || !Array.isArray(detail.loc)) continue;
    const field = detail.loc[1];
    if (detail.loc[0] !== "body") continue;
    if (field === "current_password") mapped.current_password = "Enter your current password.";
    if (field === "new_password") mapped.new_password = detail.type === "password_unchanged"
      ? "Choose a different new password." : "Use at least 8 characters for your new password.";
  }
  return mapped;
}
