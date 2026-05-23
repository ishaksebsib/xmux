import { TaggedError } from "better-result";
import type { SessionSelectionListFailure } from "../shared/session-selection";

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Returned when `/delete` targets a harness that is not configured. */
export class DeleteCommandHarnessNotConfiguredError extends TaggedError(
  "DeleteCommandHarnessNotConfiguredError",
)<{
  readonly harnessId: string;
  readonly availableHarnessIds: readonly string[];
  readonly message: string;
}>() {
  constructor(args: {
    readonly harnessId: string;
    readonly availableHarnessIds: readonly string[];
  }) {
    super({
      ...args,
      message: `Unknown harness '${args.harnessId}'. Available harnesses: ${
        args.availableHarnessIds.join(", ") || "none"
      }`,
    });
  }
}

/** Returned when `/delete` receives only one half of a delete target. */
export class DeleteCommandIncompleteTargetError extends TaggedError(
  "DeleteCommandIncompleteTargetError",
)<{
  readonly harnessId?: string;
  readonly shortId?: string;
  readonly message: string;
}>() {
  constructor(args: { readonly harnessId?: string; readonly shortId?: string }) {
    super({
      ...args,
      message: "Delete target must include both harness id and short session id",
    });
  }
}

/** Returned when a short id matches no listed session for the selected harness and cwd. */
export class DeleteSessionShortIdNotFoundError extends TaggedError(
  "DeleteSessionShortIdNotFoundError",
)<{
  readonly harnessId: string;
  readonly shortId: string;
  readonly cwd: string;
  readonly message: string;
}>() {
  constructor(args: {
    readonly harnessId: string;
    readonly shortId: string;
    readonly cwd: string;
  }) {
    super({
      ...args,
      message: `No ${args.harnessId} session matching '${args.shortId}' in ${args.cwd}`,
    });
  }
}

/** Returned when a short id is no longer unique for the selected harness and cwd. */
export class DeleteSessionShortIdAmbiguousError extends TaggedError(
  "DeleteSessionShortIdAmbiguousError",
)<{
  readonly harnessId: string;
  readonly shortId: string;
  readonly cwd: string;
  readonly matchingSessionIds: readonly string[];
  readonly message: string;
}>() {
  constructor(args: {
    readonly harnessId: string;
    readonly shortId: string;
    readonly cwd: string;
    readonly matchingSessionIds: readonly string[];
  }) {
    super({
      ...args,
      message: `Short id '${args.shortId}' matches multiple ${args.harnessId} sessions in ${args.cwd}`,
    });
  }
}

/** Returned when all configured harnesses fail while listing deletable sessions. */
export class DeleteSessionListAllFailedError extends TaggedError(
  "DeleteSessionListAllFailedError",
)<{
  readonly failures: readonly SessionSelectionListFailure[];
  readonly message: string;
}>() {
  constructor(args: { readonly failures: readonly SessionSelectionListFailure[] }) {
    super({
      ...args,
      message: `Failed to list sessions for every configured harness: ${args.failures
        .map((failure) => `${failure.harnessId}: ${failure.error.message}`)
        .join("; ")}`,
    });
  }
}

/** Returned when the `/delete` response cannot be sent back to chat. */
export class DeleteCommandResponseError extends TaggedError("DeleteCommandResponseError")<{
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: { readonly cause: unknown }) {
    super({ ...args, message: `Failed to send /delete response: ${describeCause(args.cause)}` });
  }
}
