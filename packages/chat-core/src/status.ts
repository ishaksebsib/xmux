import type { ChatLifecycleState } from "./lifecycle";

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

function taggedErrorName(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("_tag" in value)) {
    return undefined;
  }

  return typeof value._tag === "string" ? value._tag : undefined;
}

function safeIdentifier(value: string | undefined): string | undefined {
  return value !== undefined && SAFE_REASON_PATTERN.test(value) ? value : undefined;
}

/**
 * Returns a bounded, non-message failure reason suitable for status snapshots.
 * Raw messages and serialized causes are intentionally excluded because SDK
 * errors may contain request URLs, tokens, or other sensitive configuration.
 */
export function safeStatusReason(cause: unknown): string {
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
