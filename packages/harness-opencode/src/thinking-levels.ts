import type { HarnessThinkingLevel, HarnessThinkingLevelMap } from "@xmux/harness-core";
import type { OpenCodeThinkingNativeValue } from "./types";

export const orderedOpenCodeThinkingLevels = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const satisfies readonly HarnessThinkingLevel[];

export const defaultOpenCodeThinkingLevelMap = {
  off: undefined,
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "code-extreme",
} satisfies HarnessThinkingLevelMap<OpenCodeThinkingNativeValue>;
