export type JsonLogValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonLogValue[]
  | { readonly [key: string]: JsonLogValue };

const REDACTED = "[redacted]";
const SECRET_KEY_PATTERN =
  /(?:token|password|secret|api[-_]?key|authorization|client[-_]?secret|bot[-_]?token)/iu;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]+/giu;
const KEY_VALUE_SECRET_PATTERN =
  /((?:token|password|secret|api[-_]?key|authorization|client[-_]?secret|bot[-_]?token)\s*[:=]\s*)([^\s,}]+)/giu;

const isSecretKey = (key: string): boolean => SECRET_KEY_PATTERN.test(key);

/** Redact obvious secret fragments embedded in string payloads. */
export const redactString = (value: string): string =>
  value
    .replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
    .replace(KEY_VALUE_SECRET_PATTERN, (_match, prefix: string) => `${prefix}${REDACTED}`);

const isRecordLike = (value: object): boolean =>
  Object.prototype.toString.call(value) === "[object Object]";

const primitiveToJson = (value: unknown): JsonLogValue => {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "undefined") return null;
  return redactString(String(value));
};

const redactUnknownInternal = (value: unknown, seen: WeakSet<object>): JsonLogValue => {
  if (typeof value !== "object" || value === null) return primitiveToJson(value);

  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => redactUnknownInternal(item, seen));

  if (!isRecordLike(value)) return redactString(String(value));

  const output: Record<string, JsonLogValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = isSecretKey(key) ? REDACTED : redactUnknownInternal(entry, seen);
  }
  return output;
};

/** Recursively redact log metadata into schema-valid JSON before disk/API boundaries. */
export const redactUnknown = (value: unknown): JsonLogValue =>
  redactUnknownInternal(value, new WeakSet());

/** Redact a record while preserving JSON-only values for schema constructors. */
export const redactRecord = (value: Record<string, unknown>): Record<string, JsonLogValue> => {
  const redacted: Record<string, JsonLogValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    redacted[key] = isSecretKey(key) ? REDACTED : redactUnknown(entry);
  }
  return redacted;
};
