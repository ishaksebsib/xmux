import type { CliOutputCapabilities } from "./capabilities";

export type UiSeverity = "success" | "info" | "warning" | "danger" | "muted";

export type UiToken = UiSeverity | "title" | "label" | "value" | "code" | "timestamp";

const ESCAPE = String.fromCharCode(27);
const ANSI_PATTERN = new RegExp(`${ESCAPE}(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~])`, "gu");

const colorCode = (token: UiToken): string => {
  switch (token) {
    case "title":
      return "\x1b[1m";
    case "success":
      return "\x1b[32m";
    case "info":
      return "\x1b[36m";
    case "warning":
      return "\x1b[33m";
    case "danger":
      return "\x1b[31m";
    case "muted":
    case "timestamp":
      return "\x1b[2m";
    case "code":
      return "\x1b[36m";
    case "label":
    case "value":
      return "";
  }
};

export const styleToken = (
  capabilities: CliOutputCapabilities,
  token: UiToken | undefined,
  value: string,
): string => {
  if (token === undefined || !capabilities.color || value.length === 0) return value;

  const code = colorCode(token);
  return code.length === 0 ? value : `${code}${value}\x1b[0m`;
};

export const stripAnsi = (value: string): string => value.replace(ANSI_PATTERN, "");

const isZeroWidthCodePoint = (codePoint: number): boolean =>
  (codePoint >= 0x0300 && codePoint <= 0x036f) ||
  (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
  (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
  (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
  (codePoint >= 0xfe20 && codePoint <= 0xfe2f) ||
  codePoint === 0x200d ||
  codePoint === 0xfe0e ||
  codePoint === 0xfe0f;

const isWideCodePoint = (codePoint: number): boolean =>
  (codePoint >= 0x1100 && codePoint <= 0x115f) ||
  codePoint === 0x2329 ||
  codePoint === 0x232a ||
  (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
  (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
  (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
  (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
  (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
  (codePoint >= 0xff00 && codePoint <= 0xff60) ||
  (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
  (codePoint >= 0x1f300 && codePoint <= 0x1faff);

const characterWidth = (character: string): number => {
  const codePoint = character.codePointAt(0);
  if (codePoint === undefined) return 0;
  if (codePoint === 0 || codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;
  if (isZeroWidthCodePoint(codePoint)) return 0;
  return isWideCodePoint(codePoint) ? 2 : 1;
};

export const displayWidth = (value: string): number =>
  Array.from(stripAnsi(value)).reduce((width, character) => width + characterWidth(character), 0);

export const padRight = (value: string, width: number): string => {
  const padding = width - displayWidth(value);
  return padding <= 0 ? value : `${value}${" ".repeat(padding)}`;
};

export const severityIcon = (capabilities: CliOutputCapabilities, severity: UiSeverity): string => {
  if (!capabilities.unicode) {
    switch (severity) {
      case "success":
        return "+";
      case "info":
        return "*";
      case "warning":
        return "!";
      case "danger":
        return "x";
      case "muted":
        return "-";
    }
  }

  switch (severity) {
    case "success":
      return "✓";
    case "info":
      return "●";
    case "warning":
      return "◌";
    case "danger":
      return "✕";
    case "muted":
      return "○";
  }
};

export const statusText = (
  capabilities: CliOutputCapabilities,
  severity: UiSeverity,
  label: string,
): string => `${severityIcon(capabilities, severity)} ${label}`;
