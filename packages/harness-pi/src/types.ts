import type {
  HarnessAdapterDefinition,
  HarnessModelRef,
  HarnessThinkingLevel,
} from "@xmux/harness-core";

export type PiCreateOptions = {
  readonly agentDir?: string;
  readonly sessionDir?: string;
  readonly sessionPath?: string;
  readonly parentSession?: string;
  readonly tools?: readonly string[];
  readonly excludeTools?: readonly string[];
  readonly noTools?: "all" | "builtin";
};

export type PiSessionInfo = {
  readonly sessionFile?: string;
  readonly sessionDir?: string;
  readonly agentDir?: string;
  readonly name?: string;
  readonly messageCount?: number;
  readonly created?: string;
  readonly modified?: string;
};

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

export type PiAdapterConfig = {
  readonly agentDir?: string;
  readonly sessionDir?: string;
  readonly defaultModel?: HarnessModelRef;
  readonly defaultThinking?: HarnessThinkingLevel;
  readonly tools?: readonly string[];
  readonly excludeTools?: readonly string[];
  readonly noTools?: "all" | "builtin";
};

export type PiAdapter = HarnessAdapterDefinition<
  "pi",
  PiCreateOptions,
  PiSessionInfo,
  PiModelInfo
>;
