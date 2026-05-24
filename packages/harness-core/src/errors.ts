import { TaggedError } from "better-result";

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
  | HarnessAdapterResumeSessionError;

export type ListSessionsError =
  | UnknownHarnessError
  | HarnessAdapterOpenError
  | HarnessAdapterListSessionsError;

export type GetSessionError =
  | UnknownHarnessError
  | HarnessAdapterOpenError
  | HarnessAdapterGetSessionError;

export type PromptError =
  | UnknownHarnessError
  | InvalidWorkingDirectoryError
  | HarnessAdapterOpenError
  | HarnessAdapterPromptError;

export type DeleteSessionError =
  | UnknownHarnessError
  | HarnessAdapterOpenError
  | HarnessAdapterDeleteSessionError;

export type AbortError = UnknownHarnessError | HarnessAdapterOpenError | HarnessAdapterAbortError;
