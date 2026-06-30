import { Cause } from "effect";
import type { CliOutputCapabilities } from "./capabilities";
import { plainCliOutputCapabilities } from "./capabilities";
import { statusText, styleToken } from "./theme";

const DEBUG_LOG_LEVELS = new Set(["all", "trace", "debug"]);

export const shouldRenderDebugErrors = (argv: ReadonlyArray<string>): boolean => {
  if (argv.includes("--debug")) return true;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--log-level") {
      const level = argv[index + 1]?.trim().toLowerCase();
      return level !== undefined && DEBUG_LOG_LEVELS.has(level);
    }
    if (value?.startsWith("--log-level=")) {
      return DEBUG_LOG_LEVELS.has(value.slice("--log-level=".length).trim().toLowerCase());
    }
  }

  return false;
};

const objectMessage = (value: object): string | undefined => {
  if ("message" in value) {
    const message = value.message;
    return typeof message === "string" && message.trim().length > 0 ? message.trim() : undefined;
  }
  return undefined;
};

export const formatUnknownError = (value: unknown): string => {
  if (value instanceof Error && value.message.trim().length > 0) return value.message.trim();
  if (typeof value === "object" && value !== null)
    return objectMessage(value) ?? "Unexpected error.";
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return "Unexpected error.";
};

export const renderCliCause = (cause: Cause.Cause<unknown>, debug: boolean): string => {
  if (debug) return Cause.pretty(cause);
  return formatUnknownError(Cause.squash(cause));
};

export const renderCliFailure = (
  cause: Cause.Cause<unknown>,
  debug: boolean,
  capabilities: CliOutputCapabilities = plainCliOutputCapabilities,
): string => {
  if (debug) return renderCliCause(cause, true);

  const label = styleToken(capabilities, "danger", statusText(capabilities, "danger", "error"));
  return `${label} ${renderCliCause(cause, false)}`;
};
