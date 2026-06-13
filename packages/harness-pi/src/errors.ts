import { TaggedError } from "better-result";

function causeDetail(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Reports Pi SDK runtime startup failures with the original cause intact. */
export class PiRuntimeOpenError extends TaggedError("PiRuntimeOpenError")<{
  mode: "sdk";
  message: string;
  cause: unknown;
}>() {
  constructor(args: { readonly cause: unknown }) {
    super({
      ...args,
      mode: "sdk",
      message: `Failed to open Pi SDK runtime: ${causeDetail(args.cause)}`,
    });
  }
}

/** Wraps throwing Pi session operations so harness-core can surface typed failures. */
export class PiSessionRequestError extends TaggedError("PiSessionRequestError")<{
  operation: string;
  message: string;
  cause: unknown;
}>() {
  constructor(args: { readonly operation: string; readonly cause: unknown }) {
    super({
      ...args,
      message: `Pi session ${args.operation} request failed: ${causeDetail(args.cause)}`,
    });
  }
}

/** Describes invalid or unexpected Pi session responses without throwing. */
export class PiSessionResponseError extends TaggedError("PiSessionResponseError")<{
  operation: string;
  message: string;
  reason: string;
  detail?: string;
}>() {
  constructor(args: {
    readonly operation: string;
    readonly reason: string;
    readonly detail?: string;
  }) {
    super({
      ...args,
      message: `Pi session ${args.operation} response was invalid: ${args.reason}${args.detail ? `: ${args.detail}` : ""}`,
    });
  }
}

/** Identifies missing Pi sessions during resume, lookup, delete, or abort operations. */
export class PiSessionNotFoundError extends TaggedError("PiSessionNotFoundError")<{
  sessionId: string;
  cwd?: string;
  sessionPath?: string;
  message: string;
}>() {
  constructor(args: {
    readonly sessionId: string;
    readonly cwd?: string;
    readonly sessionPath?: string;
  }) {
    super({
      ...args,
      message: `Pi session not found: ${args.sessionId}`,
    });
  }
}

/** Prevents unsafe session resolution when the same Pi id matches multiple files. */
export class PiSessionAmbiguousError extends TaggedError("PiSessionAmbiguousError")<{
  sessionId: string;
  matches: readonly string[];
  message: string;
}>() {
  constructor(args: { readonly sessionId: string; readonly matches: readonly string[] }) {
    super({
      ...args,
      message: `Pi session id is ambiguous: ${args.sessionId}`,
    });
  }
}

/** Wraps throwing Pi model registry operations with adapter context. */
export class PiModelRequestError extends TaggedError("PiModelRequestError")<{
  operation: string;
  message: string;
  cause: unknown;
}>() {
  constructor(args: { readonly operation: string; readonly cause: unknown }) {
    super({
      ...args,
      message: `Pi model ${args.operation} request failed: ${causeDetail(args.cause)}`,
    });
  }
}

/** Explains why a requested xmux model ref cannot be selected in Pi. */
export class PiModelSelectionError extends TaggedError("PiModelSelectionError")<{
  providerId?: string;
  modelId: string;
  message: string;
}>() {
  constructor(args: {
    readonly providerId?: string;
    readonly modelId: string;
    readonly reason: string;
  }) {
    super({
      providerId: args.providerId,
      modelId: args.modelId,
      message: `Invalid Pi model ${args.providerId ? `${args.providerId}/` : ""}${args.modelId}: ${args.reason}`,
    });
  }
}

/** Reports prompt content that cannot be converted into Pi prompt input. */
export class PiPromptContentError extends TaggedError("PiPromptContentError")<{
  message: string;
  reason: string;
}>() {
  constructor(args: { readonly reason: string }) {
    super({
      ...args,
      message: `Invalid Pi prompt content: ${args.reason}`,
    });
  }
}

/** Temporary Phase 1/2 marker for operations whose Pi SDK handlers are not wired yet. */
export class PiNotImplementedError extends TaggedError("PiNotImplementedError")<{
  operation: string;
  message: string;
}>() {
  constructor(args: { readonly operation: string }) {
    super({
      ...args,
      message: `Pi adapter operation is not implemented yet: ${args.operation}`,
    });
  }
}
