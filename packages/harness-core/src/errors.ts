import { TaggedError } from "better-result";

export class UnknownHarnessError extends TaggedError("UnknownHarnessError")<{
  harnessId: string;
  availableHarnessIds: readonly string[];
  message: string;
}>() {
  constructor(args: { harnessId: string; availableHarnessIds: readonly string[] }) {
    super({
      ...args,
      message: `Unknown harness \"${args.harnessId}\". Available harnesses: ${args.availableHarnessIds.join(", ") || "(none)"}`,
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
    const detail = args.cause instanceof Error ? args.cause.message : String(args.cause);
    super({
      ...args,
      message: `Failed to open harness \"${args.harnessId}\": ${detail}`,
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
    const detail = args.cause instanceof Error ? args.cause.message : String(args.cause);
    super({
      ...args,
      message: `Failed to create session with harness \"${args.harnessId}\": ${detail}`,
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
