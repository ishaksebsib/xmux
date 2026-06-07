import { TaggedError } from "better-result";
import type { SessionSelectionListFailure } from "../session-selection";

export class SessionCommandIncompleteTargetError extends TaggedError(
  "SessionCommandIncompleteTargetError",
)<{
  readonly command: string;
  readonly harnessId?: string;
  readonly shortId?: string;
  readonly message: string;
}>() {
  constructor(args: {
    readonly command: string;
    readonly harnessId?: string;
    readonly shortId?: string;
  }) {
    super({
      ...args,
      message: `${args.command} target must include both harness id and short session id`,
    });
  }
}

export class SessionShortIdNotFoundError extends TaggedError("SessionShortIdNotFoundError")<{
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

export class SessionShortIdAmbiguousError extends TaggedError("SessionShortIdAmbiguousError")<{
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

export class SessionListAllFailedError extends TaggedError("SessionListAllFailedError")<{
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
