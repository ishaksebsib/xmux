import { TaggedError } from "better-result";
import type { SessionRef } from "./contracts";

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export class UnknownHarnessError extends TaggedError("UnknownHarnessError")<{
  harnessId: string;
  availableHarnessIds: readonly string[];
  message: string;
}>() {
  constructor(args: { harnessId: string; availableHarnessIds: readonly string[] }) {
    super({
      ...args,
      message: `Unknown harness "${args.harnessId}". Available harnesses: ${args.availableHarnessIds.join(", ") || "(none)"}`,
    });
  }
}

export class InvalidWorkingDirectoryError extends TaggedError("InvalidWorkingDirectoryError")<{
  cwd: string;
  message: string;
  cause?: unknown;
}>() {
  constructor(args: { cwd: string; cause?: unknown; reason?: string }) {
    super({
      cwd: args.cwd,
      cause: args.cause,
      message: args.reason ?? `Working directory is invalid: ${args.cwd}`,
    });
  }
}

export type HarnessSessionOperation =
  | "resumeSession"
  | "getSession"
  | "prompt"
  | "deleteSession"
  | "abort"
  | "respondInteraction";

export class HarnessSessionNotFoundError extends TaggedError("HarnessSessionNotFoundError")<{
  readonly ref: SessionRef;
  readonly operation: HarnessSessionOperation;
  readonly message: string;
  readonly cause?: unknown;
}>() {
  constructor(args: {
    readonly ref: SessionRef;
    readonly operation: HarnessSessionOperation;
    readonly cause?: unknown;
  }) {
    super({
      ...args,
      message: `Session not found for ${args.operation}: ${args.ref.harnessId}:${args.ref.sessionId}`,
    });
  }
}

export class HarnessAdapterOpenError extends TaggedError("HarnessAdapterOpenError")<{
  harnessId: string;
  message: string;
  cause: unknown;
}>() {
  constructor(args: { harnessId: string; cause: unknown }) {
    super({
      ...args,
      message: `Failed to open harness "${args.harnessId}": ${describeCause(args.cause)}`,
    });
  }
}

export class HarnessAdapterCreateSessionError extends TaggedError(
  "HarnessAdapterCreateSessionError",
)<{
  harnessId: string;
  message: string;
  cause: unknown;
}>() {
  constructor(args: { harnessId: string; cause: unknown }) {
    super({
      ...args,
      message: `Failed to create session with harness "${args.harnessId}": ${describeCause(args.cause)}`,
    });
  }
}

export class HarnessAdapterResumeSessionError extends TaggedError(
  "HarnessAdapterResumeSessionError",
)<{
  harnessId: string;
  message: string;
  cause: unknown;
}>() {
  constructor(args: { harnessId: string; cause: unknown }) {
    super({
      ...args,
      message: `Failed to resume session with harness "${args.harnessId}": ${describeCause(args.cause)}`,
    });
  }
}

export class HarnessAdapterListSessionsError extends TaggedError(
  "HarnessAdapterListSessionsError",
)<{
  harnessId: string;
  message: string;
  cause: unknown;
}>() {
  constructor(args: { harnessId: string; cause: unknown }) {
    super({
      ...args,
      message: `Failed to list sessions with harness "${args.harnessId}": ${describeCause(args.cause)}`,
    });
  }
}

export class HarnessAdapterGetSessionError extends TaggedError("HarnessAdapterGetSessionError")<{
  harnessId: string;
  message: string;
  cause: unknown;
}>() {
  constructor(args: { harnessId: string; cause: unknown }) {
    super({
      ...args,
      message: `Failed to get session with harness "${args.harnessId}": ${describeCause(args.cause)}`,
    });
  }
}

export class HarnessAdapterModelUnsupportedError extends TaggedError(
  "HarnessAdapterModelUnsupportedError",
)<{
  harnessId: string;
  operation: "listModels" | "getModel" | "setModel";
  message: string;
}>() {
  constructor(args: { harnessId: string; operation: "listModels" | "getModel" | "setModel" }) {
    super({
      ...args,
      message: `Harness "${args.harnessId}" does not support ${args.operation}`,
    });
  }
}

export class HarnessAdapterListModelsError extends TaggedError("HarnessAdapterListModelsError")<{
  harnessId: string;
  message: string;
  cause: unknown;
}>() {
  constructor(args: { harnessId: string; cause: unknown }) {
    super({
      ...args,
      message: `Failed to list models with harness "${args.harnessId}": ${describeCause(args.cause)}`,
    });
  }
}

export class HarnessAdapterGetModelError extends TaggedError("HarnessAdapterGetModelError")<{
  harnessId: string;
  message: string;
  cause: unknown;
}>() {
  constructor(args: { harnessId: string; cause: unknown }) {
    super({
      ...args,
      message: `Failed to get selected model with harness "${args.harnessId}": ${describeCause(args.cause)}`,
    });
  }
}

export class HarnessAdapterSetModelError extends TaggedError("HarnessAdapterSetModelError")<{
  harnessId: string;
  message: string;
  cause: unknown;
}>() {
  constructor(args: { harnessId: string; cause: unknown }) {
    super({
      ...args,
      message: `Failed to set selected model with harness "${args.harnessId}": ${describeCause(args.cause)}`,
    });
  }
}

export class HarnessAdapterThinkingUnsupportedError extends TaggedError(
  "HarnessAdapterThinkingUnsupportedError",
)<{
  harnessId: string;
  operation: "getThinking" | "setThinking";
  message: string;
}>() {
  constructor(args: { harnessId: string; operation: "getThinking" | "setThinking" }) {
    super({
      ...args,
      message: `Harness "${args.harnessId}" does not support ${args.operation}`,
    });
  }
}

export class HarnessAdapterGetThinkingError extends TaggedError("HarnessAdapterGetThinkingError")<{
  harnessId: string;
  message: string;
  cause: unknown;
}>() {
  constructor(args: { harnessId: string; cause: unknown }) {
    super({
      ...args,
      message: `Failed to get selected thinking level with harness "${args.harnessId}": ${describeCause(args.cause)}`,
    });
  }
}

export class HarnessAdapterSetThinkingError extends TaggedError("HarnessAdapterSetThinkingError")<{
  harnessId: string;
  message: string;
  cause: unknown;
}>() {
  constructor(args: { harnessId: string; cause: unknown }) {
    super({
      ...args,
      message: `Failed to set selected thinking level with harness "${args.harnessId}": ${describeCause(args.cause)}`,
    });
  }
}

export class HarnessAdapterPromptError extends TaggedError("HarnessAdapterPromptError")<{
  harnessId: string;
  message: string;
  cause: unknown;
}>() {
  constructor(args: { harnessId: string; cause: unknown }) {
    super({
      ...args,
      message: `Failed to prompt session with harness "${args.harnessId}": ${describeCause(args.cause)}`,
    });
  }
}

export class PromptStreamEndedWithoutTerminalEventError extends TaggedError(
  "PromptStreamEndedWithoutTerminalEventError",
)<{
  readonly harnessId: string;
  readonly sessionId: string;
  readonly message: string;
}>() {
  constructor(args: { readonly harnessId: string; readonly sessionId: string }) {
    super({
      ...args,
      message: `Prompt stream ended without a terminal run event: ${args.harnessId}:${args.sessionId}`,
    });
  }
}

export class HarnessAdapterDeleteSessionError extends TaggedError(
  "HarnessAdapterDeleteSessionError",
)<{
  harnessId: string;
  message: string;
  cause: unknown;
}>() {
  constructor(args: { harnessId: string; cause: unknown }) {
    super({
      ...args,
      message: `Failed to delete session with harness "${args.harnessId}": ${describeCause(args.cause)}`,
    });
  }
}

export class HarnessAdapterAbortError extends TaggedError("HarnessAdapterAbortError")<{
  harnessId: string;
  message: string;
  cause: unknown;
}>() {
  constructor(args: { harnessId: string; cause: unknown }) {
    super({
      ...args,
      message: `Failed to abort session with harness "${args.harnessId}": ${describeCause(args.cause)}`,
    });
  }
}

export class HarnessAdapterInteractionUnsupportedError extends TaggedError(
  "HarnessAdapterInteractionUnsupportedError",
)<{
  readonly harnessId: string;
  readonly operation: "respondInteraction";
  readonly message: string;
}>() {
  constructor(args: { readonly harnessId: string; readonly operation: "respondInteraction" }) {
    super({
      ...args,
      message: `Harness "${args.harnessId}" does not support ${args.operation}`,
    });
  }
}

export class HarnessAdapterRespondInteractionError extends TaggedError(
  "HarnessAdapterRespondInteractionError",
)<{
  readonly harnessId: string;
  readonly message: string;
  readonly cause: unknown;
}>() {
  constructor(args: { readonly harnessId: string; readonly cause: unknown }) {
    super({
      ...args,
      message: `Failed to respond to interaction with harness "${args.harnessId}": ${describeCause(args.cause)}`,
    });
  }
}

export class HarnessCloseError extends TaggedError("HarnessCloseError")<{
  failures: readonly { harnessId: string; cause: unknown }[];
  message: string;
}>() {
  constructor(args: { failures: readonly { harnessId: string; cause: unknown }[] }) {
    const harnessIds = args.failures.map((failure) => failure.harnessId).join(", ");
    super({
      ...args,
      message: `Failed to close harness runtimes: ${harnessIds}`,
    });
  }
}

export type CreateSessionError =
  | UnknownHarnessError
  | InvalidWorkingDirectoryError
  | HarnessAdapterOpenError
  | HarnessAdapterCreateSessionError;

export type ResumeSessionError =
  | UnknownHarnessError
  | InvalidWorkingDirectoryError
  | HarnessAdapterOpenError
  | HarnessSessionNotFoundError
  | HarnessAdapterResumeSessionError;

export type ListSessionsError =
  | UnknownHarnessError
  | HarnessAdapterOpenError
  | HarnessAdapterListSessionsError;

export type ListModelsError =
  | UnknownHarnessError
  | HarnessAdapterOpenError
  | HarnessAdapterModelUnsupportedError
  | HarnessAdapterListModelsError;

export type GetModelError =
  | UnknownHarnessError
  | HarnessAdapterOpenError
  | HarnessAdapterModelUnsupportedError
  | HarnessAdapterGetModelError;

export type SetModelError =
  | UnknownHarnessError
  | HarnessAdapterOpenError
  | HarnessAdapterModelUnsupportedError
  | HarnessAdapterSetModelError;

export type GetThinkingError =
  | UnknownHarnessError
  | HarnessAdapterOpenError
  | HarnessAdapterThinkingUnsupportedError
  | HarnessAdapterGetThinkingError;

export type SetThinkingError =
  | UnknownHarnessError
  | HarnessAdapterOpenError
  | HarnessAdapterThinkingUnsupportedError
  | HarnessAdapterSetThinkingError;

export type GetSessionError =
  | UnknownHarnessError
  | HarnessAdapterOpenError
  | HarnessSessionNotFoundError
  | HarnessAdapterGetSessionError;

export type PromptError =
  | UnknownHarnessError
  | InvalidWorkingDirectoryError
  | HarnessAdapterOpenError
  | HarnessSessionNotFoundError
  | HarnessAdapterPromptError;

export type DeleteSessionError =
  | UnknownHarnessError
  | HarnessAdapterOpenError
  | HarnessSessionNotFoundError
  | HarnessAdapterDeleteSessionError;

export type AbortError =
  | UnknownHarnessError
  | HarnessAdapterOpenError
  | HarnessSessionNotFoundError
  | HarnessAdapterAbortError;

export type RespondInteractionError =
  | UnknownHarnessError
  | InvalidWorkingDirectoryError
  | HarnessAdapterOpenError
  | HarnessSessionNotFoundError
  | HarnessAdapterInteractionUnsupportedError
  | HarnessAdapterRespondInteractionError;
