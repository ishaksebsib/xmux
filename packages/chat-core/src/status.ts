import type { ChatLifecycleState } from "./lifecycle";

export type AdapterFailureReason =
  | "authentication_failed"
  | "network_unreachable"
  | "rate_limited"
  | "permission_denied"
  | "configuration_invalid"
  | "startup_failed"
  | "unknown_error";

export type ChatAdapterRuntimeState =
  | "configured"
  | "opening"
  | "starting"
  | "active"
  | "failed"
  | "closing"
  | "stopped";

export interface ChatAdapterStatusSnapshot<TChatId extends string = string> {
  readonly id: TChatId;
  readonly state: ChatAdapterRuntimeState;
  readonly reason?: string;
}

export interface ChatRuntimeStatusSnapshot<TChatId extends string = string> {
  readonly lifecycle: ChatLifecycleState["status"];
  readonly adapters: readonly ChatAdapterStatusSnapshot<TChatId>[];
}

const SAFE_REASON_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/u;
const wrapperTags = new Set(["ChatAdapterOpenError", "ChatAdapterStartError"]);
const networkCodes = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOENT",
  "ENOTFOUND",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);
const authenticationCodes = new Set([
  "401",
  "UNAUTHORIZED",
  "INVALID_AUTH",
  "INVALID_TOKEN",
  "NOT_AUTHED",
  "TOKEN_REVOKED",
]);
const permissionCodes = new Set(["403", "FORBIDDEN", "MISSING_SCOPE", "PERMISSION_DENIED"]);
const rateLimitCodes = new Set(["429", "RATE_LIMITED", "TOO_MANY_REQUESTS"]);

function taggedErrorName(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("_tag" in value)) {
    return undefined;
  }

  return typeof value._tag === "string" ? value._tag : undefined;
}

function safeIdentifier(value: string | undefined): string | undefined {
  return value !== undefined && SAFE_REASON_PATTERN.test(value) ? value : undefined;
}

function objectField(value: unknown, field: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Object.entries(value).find(([key]) => key === field)?.[1];
}

function numericStatus(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function codeText(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0 && value.length <= 80) return value;
  if (typeof value === "number" && Number.isInteger(value)) return String(value);
  return undefined;
}

function classifyCode(code: string | undefined): AdapterFailureReason | undefined {
  if (code === undefined) return undefined;
  const normalized = code.trim().toUpperCase();
  if (authenticationCodes.has(normalized)) return "authentication_failed";
  if (permissionCodes.has(normalized)) return "permission_denied";
  if (rateLimitCodes.has(normalized)) return "rate_limited";
  if (networkCodes.has(normalized)) return "network_unreachable";
  return undefined;
}

function classifyStatus(status: number | undefined): AdapterFailureReason | undefined {
  if (status === undefined) return undefined;
  if (status === 401) return "authentication_failed";
  if (status === 403) return "permission_denied";
  if (status === 429) return "rate_limited";
  if (status >= 500 && status <= 599) return "network_unreachable";
  return undefined;
}

function classifyBoundedMessage(message: string | undefined): AdapterFailureReason | undefined {
  if (message === undefined || message.length > 500) return undefined;
  const normalized = message.toLowerCase();
  if (
    /\b(401|unauthorized|invalid[_ -]?auth|invalid[_ -]?token|not[_ -]?authed)\b/u.test(normalized)
  ) {
    return "authentication_failed";
  }
  if (/\b(403|forbidden|missing[_ -]?scope|permission denied)\b/u.test(normalized)) {
    return "permission_denied";
  }
  if (/\b(429|rate[_ -]?limit|too many requests)\b/u.test(normalized)) {
    return "rate_limited";
  }
  if (
    /\b(econnrefused|econnreset|ehostunreach|enetunreach|enotfound|etimedout|timeout|socket hang up|network)\b/u.test(
      normalized,
    )
  ) {
    return "network_unreachable";
  }
  return undefined;
}

function classifyTaggedCause(tag: string | undefined): AdapterFailureReason | undefined {
  if (tag === undefined) return undefined;
  if (tag.endsWith("ConfigurationError")) return "configuration_invalid";
  if (tag.endsWith("UnsupportedError")) return "configuration_invalid";
  return undefined;
}

function classifyAdapterFailure(
  cause: unknown,
  seen = new Set<unknown>(),
): AdapterFailureReason | undefined {
  if (typeof cause !== "object" || cause === null) {
    return classifyBoundedMessage(typeof cause === "string" ? cause : undefined);
  }
  if (seen.has(cause)) return undefined;
  seen.add(cause);

  const tag = taggedErrorName(cause);
  const nestedCause = objectField(cause, "cause");
  if (tag !== undefined && wrapperTags.has(tag)) {
    const nested = classifyAdapterFailure(nestedCause, seen);
    if (nested !== undefined) return nested;
    return tag === "ChatAdapterStartError" ? "startup_failed" : undefined;
  }

  const tagged = classifyTaggedCause(tag);
  if (tagged !== undefined) return tagged;

  const status =
    numericStatus(objectField(cause, "status")) ??
    numericStatus(objectField(cause, "statusCode")) ??
    numericStatus(objectField(cause, "status_code")) ??
    numericStatus(objectField(cause, "error_code"));
  const byStatus = classifyStatus(status);
  if (byStatus !== undefined) return byStatus;

  const byCode =
    classifyCode(codeText(objectField(cause, "code"))) ??
    classifyCode(codeText(objectField(cause, "error"))) ??
    classifyCode(codeText(objectField(cause, "errorCode")));
  if (byCode !== undefined) return byCode;

  const message = cause instanceof Error ? cause.message : codeText(objectField(cause, "message"));
  const byMessage = classifyBoundedMessage(message);
  if (byMessage !== undefined) return byMessage;

  if (nestedCause !== undefined) return classifyAdapterFailure(nestedCause, seen);
  return undefined;
}

/**
 * Returns a bounded, non-message failure reason suitable for status snapshots.
 * Raw messages and serialized causes are intentionally excluded because SDK
 * errors may contain request URLs, tokens, or other sensitive configuration.
 */
export function safeStatusReason(cause: unknown): string {
  const classified = classifyAdapterFailure(cause);
  if (classified !== undefined) return classified;

  const tag = safeIdentifier(taggedErrorName(cause));
  if (tag !== undefined) return tag;

  if (cause instanceof Error) {
    const constructorName = safeIdentifier(cause.constructor.name);
    if (constructorName !== undefined) return constructorName;

    const errorName = safeIdentifier(cause.name);
    if (errorName !== undefined) return errorName;
  }

  return "unknown_error";
}
