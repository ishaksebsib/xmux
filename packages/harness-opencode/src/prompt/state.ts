import type { PromptStreamState } from "./types";

export function createPromptStreamState(): PromptStreamState {
  return {
    completedMessages: new Set(),
    completedParts: new Set(),
    completedTools: new Set(),
    inputCompletedTools: new Set(),
    calledTools: new Set(),
    messageRoles: new Map(),
    partKinds: new Map(),
    partTexts: new Map(),
    seenMessages: new Set(),
    seenParts: new Set(),
    seenTools: new Set(),
    toolInputs: new Map(),
    toolNames: new Map(),
    nextCompactionPartIndex: 0,
    nextTextPartIndex: 0,
    terminalRun: false,
  };
}
