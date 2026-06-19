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

const redactUnknownInternal = (value: unknown, seen: WeakSet<object>): unknown => {
  if (typeof value === "string") return redactString(value);
  if (typeof value !== "object" || value === null) return value;

  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => redactUnknownInternal(item, seen));

  if (!isRecordLike(value)) return redactString(String(value));

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = isSecretKey(key) ? REDACTED : redactUnknownInternal(entry, seen);
  }
  return output;
};

/** Recursively redact log metadata before it can reach disk or control routes. */
export const redactUnknown = (value: unknown): unknown =>
  redactUnknownInternal(value, new WeakSet());

/** Redact a record while preserving its record type for schema constructors. */
export const redactRecord = (value: Record<string, unknown>): Record<string, unknown> => {
  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    redacted[key] = isSecretKey(key) ? REDACTED : redactUnknown(entry);
  }
  return redacted;
};
