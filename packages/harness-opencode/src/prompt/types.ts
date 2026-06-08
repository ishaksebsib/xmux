import type {
  Event as OpenCodeEvent,
  FilePartInput,
  Part,
  TextPartInput,
} from "@opencode-ai/sdk/v2";
import type {
  HarnessContentKind,
  HarnessPromptEvent,
  HarnessRunReason,
  HarnessThinkingLevel,
  HarnessTokenUsage,
} from "@xmux/harness-core";

export type OpenCodePromptEvent = HarnessPromptEvent<"opencode">;
export type OpenCodePromptPart = TextPartInput | FilePartInput;
export type OpenCodeToolPart = Extract<Part, { readonly type: "tool" }>;
export type OpenCodeStreamEvent = OpenCodeEvent;
export type EventFamily = "legacy" | "next";

export type TokenUsageInput = {
  readonly input?: number;
  readonly output?: number;
  readonly reasoning?: number;
  readonly cache?: { readonly read?: number; readonly write?: number };
  readonly total?: number;
};

export type SelectedOpenCodeModel = {
  readonly providerID: string;
  readonly modelID: string;
  readonly variant?: string;
};

export type CompletedRun = {
  readonly reason: Exclude<HarnessRunReason, "error" | "aborted">;
  readonly usage?: HarnessTokenUsage;
  readonly cost?: number;
};

export type PromptStreamState = {
  readonly completedMessages: Set<string>;
  readonly completedParts: Set<string>;
  readonly completedTools: Set<string>;
  readonly inputCompletedTools: Set<string>;
  readonly calledTools: Set<string>;
  readonly messageRoles: Map<string, "user" | "assistant">;
  readonly partKinds: Map<string, HarnessContentKind>;
  readonly partTexts: Map<string, string>;
  readonly seenMessages: Set<string>;
  readonly seenParts: Set<string>;
  readonly seenTools: Set<string>;
  readonly toolInputs: Map<string, string>;
  readonly toolNames: Map<string, string>;
  currentNextCompactionPartId?: string;
  currentNextTextPartId?: string;
  currentNextTurnId?: string;
  eventFamily?: EventFamily;
  nextCompactionPartIndex: number;
  nextTextPartIndex: number;
  selectedThinking?: HarnessThinkingLevel;
  terminalRun: boolean;
  completedRun?: CompletedRun;
};
