export type Brand<TValue, TBrand extends string> = TValue & { readonly __brand: TBrand };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Renders an unknown thrown/rejected cause as a human-readable string. */
export function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export interface SessionRefLike {
  readonly harnessId: string;
  readonly sessionId: string;
}

export function formatSessionRef(ref: SessionRefLike): string {
  return `${ref.harnessId}:${ref.sessionId}`;
}

export function sessionKey(ref: SessionRefLike): string {
  return JSON.stringify([ref.harnessId, ref.sessionId]);
}

export function sameSessionRef(left: SessionRefLike, right: SessionRefLike): boolean {
  return left.harnessId === right.harnessId && left.sessionId === right.sessionId;
}

export function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export function describeUnknown(value: unknown): string {
  if (value === undefined) return "";
  return value instanceof Error ? value.message : stringifyUnknown(value);
}
