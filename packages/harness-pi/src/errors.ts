import { TaggedError } from "better-result";

function causeDetail(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Reports Pi SDK runtime startup failures with the original cause intact. */
export class PiRuntimeOpenError extends TaggedError("PiRuntimeOpenError")<{
  message: string;
  cause: unknown;
}>() {
  constructor(args: { readonly cause: unknown }) {
    super({
      ...args,
      message: `Failed to open Pi SDK runtime: ${causeDetail(args.cause)}`,
    });
  }
}

/** Wraps throwing Pi session operations so harness-core can surface typed failures. */
export class PiSessionRequestError extends TaggedError("PiSessionRequestError")<{
  message: string;
  cause: unknown;
}>() {
  constructor(args: { readonly cause: unknown }) {
    super({
      ...args,
      message: `Pi session request failed: ${causeDetail(args.cause)}`,
    });
  }
}

/** Describes invalid or unexpected Pi session responses without throwing. */
export class PiSessionResponseError extends TaggedError("PiSessionResponseError")<{
  message: string;
  reason: string;
  detail?: string;
}>() {
  constructor(args: { readonly reason: string; readonly detail?: string }) {
    super({
      ...args,
      message: `${args.reason}${args.detail ? `: ${args.detail}` : ""}`,
    });
  }
}

/** Identifies missing Pi sessions during resume, lookup, delete, or abort operations. */
export class PiSessionNotFoundError extends TaggedError("PiSessionNotFoundError")<{
  sessionId: string;
  message: string;
}>() {
  constructor(args: { readonly sessionId: string }) {
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
  message: string;
  cause: unknown;
}>() {
  constructor(args: { readonly cause: unknown }) {
    super({
      ...args,
      message: `Pi model request failed: ${causeDetail(args.cause)}`,
    });
  }
}

/** Explains why a requested xmux model ref cannot be selected in Pi. */
export class PiModelSelectionError extends TaggedError("PiModelSelectionError")<{
  modelId: string;
  message: string;
}>() {
  constructor(args: { readonly modelId: string; readonly reason: string }) {
    super({
      modelId: args.modelId,
      message: `Invalid Pi model ${args.modelId}: ${args.reason}`,
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
