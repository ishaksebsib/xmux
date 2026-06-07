import { TaggedError } from "better-result";
import type { ListSessionsError } from "@xmux/harness-core";

/** Returned when `/resume` receives only one half of a resume target. */
export class ResumeCommandIncompleteTargetError extends TaggedError(
  "ResumeCommandIncompleteTargetError",
)<{
  readonly harnessId?: string;
  readonly shortId?: string;
  readonly message: string;
}>() {
  constructor(args: { readonly harnessId?: string; readonly shortId?: string }) {
    super({
      ...args,
      message: "Resume target must include both harness id and short session id",
    });
  }
}

/** Returned when a short id matches no listed session for the selected harness and cwd. */
export class ResumeSessionShortIdNotFoundError extends TaggedError(
  "ResumeSessionShortIdNotFoundError",
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
export class ResumeSessionShortIdAmbiguousError extends TaggedError(
  "ResumeSessionShortIdAmbiguousError",
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

/** Returned when all configured harnesses fail while listing resumable sessions. */
export class ResumeSessionListAllFailedError extends TaggedError(
  "ResumeSessionListAllFailedError",
)<{
  readonly failures: readonly ResumeSessionListFailure[];
  readonly message: string;
}>() {
  constructor(args: { readonly failures: readonly ResumeSessionListFailure[] }) {
    super({
      ...args,
      message: `Failed to list sessions for every configured harness: ${args.failures
        .map((failure) => `${failure.harnessId}: ${failure.error.message}`)
        .join("; ")}`,
    });
  }
}

export interface ResumeSessionListFailure {
  readonly harnessId: string;
  readonly error: ListSessionsError;
}
