import type {
  HarnessAdapterDefinition,
  HarnessModelRef,
  HarnessThinkingLevel,
} from "@xmux/harness-core";

/**
 * Per-call Pi options let callers choose session storage and tool policy without
 * changing adapter-wide defaults shared by other sessions.
 */
export type PiCreateOptions = {
  readonly agentDir?: string;
  readonly sessionDir?: string;
  readonly sessionPath?: string;
  readonly parentSession?: string;
  readonly tools?: readonly string[];
  readonly excludeTools?: readonly string[];
  readonly noTools?: "all" | "builtin";
};

/**
 * Pi-native session metadata is preserved so consumers can resume or inspect the
 * underlying Pi JSONL session when the unified session id is not enough.
 */
export type PiSessionInfo = {
  readonly sessionFile?: string;
  readonly sessionDir?: string;
  readonly agentDir?: string;
  readonly name?: string;
  readonly messageCount?: number;
  readonly created?: string;
  readonly modified?: string;
};

/**
 * Pi-native model metadata is exposed alongside xmux's normalized model shape so
 * consumers can make Pi-specific capability decisions when needed.
 */
export type PiModelInfo = {
  readonly provider: string;
  readonly id: string;
  readonly api: string;
  readonly name?: string;
  readonly reasoning: boolean;
  readonly contextWindow: number;
  readonly maxTokens: number;
  readonly input: readonly ("text" | "image")[];
};

/**
 * Adapter defaults centralize Pi filesystem/model/tool preferences while still
 * allowing safe per-call overrides through `PiCreateOptions`.
 */
export type PiAdapterConfig = {
  readonly agentDir?: string;
  readonly sessionDir?: string;
  readonly defaultModel?: HarnessModelRef;
  readonly defaultThinking?: HarnessThinkingLevel;
  readonly tools?: readonly string[];
  readonly excludeTools?: readonly string[];
  readonly noTools?: "all" | "builtin";
};

/**
 * Concrete harness-core adapter definition for Pi, binding the `pi` id to Pi's
 * adapter options and native metadata types.
 */
export type PiAdapter = HarnessAdapterDefinition<"pi", PiCreateOptions, PiSessionInfo, PiModelInfo>;
