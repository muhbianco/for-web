export const UNVERIFIED_ACCOUNT = "UnverifiedAccount";
export const OPERATION_FAILED = "OperationFailed";

/**
 * Stoat API errors arrive as `{ type }` or as a JSON string of that object.
 */
export function apiErrorType(error: unknown): string {
  let value: unknown = error;
  if (typeof error === "string") {
    try {
      value = JSON.parse(error);
    } catch {
      return "";
    }
  }
  if (value && typeof value === "object" && "type" in value) {
    const type = (value as { type: unknown }).type;
    return typeof type === "string" ? type : "";
  }
  return "";
}

export function emailVerificationEnabled(
  live: { features?: { email?: boolean } } | undefined,
  fallback: boolean,
): boolean {
  if (typeof live?.features?.email === "boolean") {
    return live.features.email;
  }
  return fallback;
}

/**
 * After signup (or a login that proves the account is still pending), send
 * the user to the inbox screen instead of showing UnverifiedAccount.
 */
export function shouldPromptCheckEmail(input: {
  emailVerificationEnabled: boolean;
  loginErrorType: string;
}): boolean {
  return (
    input.loginErrorType === UNVERIFIED_ACCOUNT ||
    input.emailVerificationEnabled
  );
}
