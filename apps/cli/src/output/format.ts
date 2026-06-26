export type JsonValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue | undefined };

export const formatJson = (value: JsonValue | undefined): string =>
  `${JSON.stringify(value ?? null, null, 2)}\n`;

export const formatKeyValueLines = (
  rows: ReadonlyArray<readonly [label: string, value: string | number | boolean | undefined]>,
): string =>
  `${rows
    .filter((row) => row[1] !== undefined)
    .map(([label, value]) => `${label}: ${String(value)}`)
    .join("\n")}\n`;
