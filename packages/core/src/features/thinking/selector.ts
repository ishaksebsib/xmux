import type { HarnessThinkingLevel } from "@xmux/harness-core";
import { Result } from "better-result";
import { ThinkingLevelInvalidError } from "./errors";

export const thinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type ParsedThinkingSelector =
  | { readonly type: "show" }
  | { readonly type: "clear" }
  | { readonly type: "set"; readonly level: HarnessThinkingLevel };

/** Parses the optional `/thinking` argument into a typed command action. */
export function parseThinkingSelector(
  selector: string | undefined,
): Result<ParsedThinkingSelector, ThinkingLevelInvalidError> {
  const raw = selector?.trim();

  if (!raw) {
    return Result.ok({ type: "show" });
  }

  const normalized = raw.toLowerCase();

  if (normalized === "clear") {
    return Result.ok({ type: "clear" });
  }

  if (isThinkingLevel(normalized)) {
    return Result.ok({ type: "set", level: normalized });
  }

  return Result.err(
    new ThinkingLevelInvalidError({ selector: raw, availableLevels: thinkingLevels }),
  );
}

function isThinkingLevel(value: string): value is HarnessThinkingLevel {
  return (thinkingLevels as readonly string[]).includes(value);
}
