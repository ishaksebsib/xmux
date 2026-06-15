import { TaggedError } from "better-result";
import type { SessionRef } from "@xmux/harness-core";
import type { HarnessModelRef, HarnessThinkingLevel } from "@xmux/harness-core";

/** Returned when thinking is requested before the session has a selected model. */
export class ThinkingModelUnsetError extends TaggedError("ThinkingModelUnsetError")<{
  readonly sessionRef: SessionRef;
  readonly message: string;
}>() {
  constructor(args: { readonly sessionRef: SessionRef }) {
    super({
      ...args,
      message: `Session model is unset: ${args.sessionRef.harnessId}:${args.sessionRef.sessionId}`,
    });
  }
}

/** Returned when the active model has no configurable thinking support. */
export class ThinkingModelThinkingUnsupportedError extends TaggedError(
  "ThinkingModelThinkingUnsupportedError",
)<{
  readonly model?: HarnessModelRef;
  readonly message: string;
}>() {
  constructor(args: { readonly model?: HarnessModelRef }) {
    const ref = args.model;
    const name = ref
      ? ref.providerId === undefined
        ? ref.modelId
        : `${ref.providerId}/${ref.modelId}`
      : undefined;
    super({
      ...args,
      message: ref
        ? `Model does not support configurable thinking: ${name}`
        : "Model does not support configurable thinking",
    });
  }
}

/** Returned when the requested thinking level is not a canonical harness level. */
export class ThinkingLevelInvalidError extends TaggedError("ThinkingLevelInvalidError")<{
  readonly selector: string;
  readonly availableLevels: readonly HarnessThinkingLevel[];
  readonly message: string;
}>() {
  constructor(args: {
    readonly selector: string;
    readonly availableLevels: readonly HarnessThinkingLevel[];
  }) {
    super({ ...args, message: `Invalid thinking level: ${args.selector}` });
  }
}

/** Returned when the active harness reports that a canonical level is unavailable. */
export class ThinkingLevelUnsupportedError extends TaggedError("ThinkingLevelUnsupportedError")<{
  readonly level: HarnessThinkingLevel;
  readonly supportedLevels: readonly HarnessThinkingLevel[];
  readonly message: string;
}>() {
  constructor(args: {
    readonly level: HarnessThinkingLevel;
    readonly supportedLevels: readonly HarnessThinkingLevel[];
  }) {
    super({ ...args, message: `Thinking level is not supported: ${args.level}` });
  }
}
