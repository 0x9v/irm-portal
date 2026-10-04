import { ApiError } from "./api";

export interface FormErrors {
  general?: string;
  fields: Record<string, string>;
}

interface PydanticValidationError {
  loc?: (string | number)[];
  msg?: string;
  type?: string;
}

export function formatFormError(err: unknown, defaultMessage = "An unexpected error occurred. Please try again."): FormErrors {
  const result: FormErrors = { fields: {} };

  if (err instanceof ApiError) {
    if (err.status === 401) {
      result.general = "Invalid email or password. Please check your credentials and try again.";
      return result;
    }

    if (err.status === 403) {
      result.general = "Access denied. You do not have permission to perform this action.";
      return result;
    }

    if (err.status === 404) {
      result.general = "The requested resource was not found.";
      return result;
    }

    if (err.status === 409) {
      result.general = err.message || "A conflict occurred with your request.";
      return result;
    }

    if (err.status === 422 && Array.isArray(err.details)) {
      const details = err.details as PydanticValidationError[];
      for (const item of details) {
        if (!item.loc || item.loc.length === 0) continue;
        const fieldName = String(item.loc[item.loc.length - 1]);
        const msg = item.msg || "";
        const type = item.type || "";

        // Friendly mapping for known fields
        if (fieldName === "password") {
          if (type.includes("too_short") || msg.toLowerCase().includes("at least 8")) {
            result.fields.password = "Your password must contain at least 8 characters.";
          } else {
            result.fields.password = "Please enter a valid password (at least 8 characters).";
          }
        } else if (fieldName === "username") {
          if (type.includes("too_short") || msg.toLowerCase().includes("at least 3")) {
            result.fields.username = "Your username must contain at least 3 characters.";
          } else if (type.includes("too_long") || msg.toLowerCase().includes("at most 50")) {
            result.fields.username = "Your username cannot exceed 50 characters.";
          } else {
            result.fields.username = "Please enter a valid username.";
          }
        } else if (fieldName === "email") {
          result.fields.email = "Please enter a valid email address.";
        } else if (fieldName === "first_name") {
          result.fields.first_name = "Please enter your first name.";
        } else if (fieldName === "family_name") {
          result.fields.family_name = "Please enter your family name.";
        } else if (fieldName === "cne") {
          result.fields.cne = "Please enter a valid CNE.";
        } else {
          // Format readable label for other fields
          const readableField = fieldName.replace(/_/g, " ");
          result.fields[fieldName] = `${readableField.charAt(0).toUpperCase() + readableField.slice(1)}: ${msg}`;
        }
      }

      // If no field specific errors were mapped, use general message
      if (Object.keys(result.fields).length === 0) {
        result.general = err.message;
      }
      return result;
    }

    // Default for other ApiErrors
    result.general = err.message || defaultMessage;
    return result;
  }

  if (err instanceof Error) {
    if (err.message.toLowerCase().includes("network error") || err.message.toLowerCase().includes("failed to fetch")) {
      result.general = "Unable to connect to the server. Please check your network connection and try again.";
    } else {
      result.general = err.message || defaultMessage;
    }
    return result;
  }

  result.general = defaultMessage;
  return result;
}
