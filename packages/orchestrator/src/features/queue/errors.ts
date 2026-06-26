import type { SessionRef } from "@xmux/harness-core";
import { describeCause, formatSessionRef } from "../../utils";
import { TaggedError } from "better-result";
import type { QueueItemId } from "./primitives";

export class PromptQueueFullError extends TaggedError("PromptQueueFullError")<{
  readonly sessionRef: SessionRef;
  readonly maxItems: number;
  readonly message: string;
}>() {
  constructor(args: { readonly sessionRef: SessionRef; readonly maxItems: number }) {
    super({
      ...args,
      message: `Prompt queue is full for session ${formatSessionRef(args.sessionRef)} (${args.maxItems} item limit)`,
    });
  }
}

export class PromptQueueOfferNotFoundError extends TaggedError("PromptQueueOfferNotFoundError")<{
  readonly offerId: string;
  readonly message: string;
}>() {
  constructor(args: { readonly offerId: string }) {
    super({ ...args, message: `Prompt queue offer is no longer available: ${args.offerId}` });
  }
}

export class PromptQueueItemNotFoundError extends TaggedError("PromptQueueItemNotFoundError")<{
  readonly sessionRef: SessionRef;
  readonly index?: number;
  readonly itemId?: string;
  readonly message: string;
}>() {
  constructor(args: {
    readonly sessionRef: SessionRef;
    readonly index?: number;
    readonly itemId?: string;
  }) {
    const target =
      args.index === undefined
        ? args.itemId === undefined
          ? "requested prompt"
          : `prompt ${args.itemId}`
        : `prompt at position ${args.index}`;

    super({
      ...args,
      message: `No queued ${target} for session ${formatSessionRef(args.sessionRef)}`,
    });
  }
}

export class PromptQueueOfferStateConflictError extends TaggedError(
  "PromptQueueOfferStateConflictError",
)<{
  readonly offerId: string;
  readonly state: "offered" | "queued" | "sent";
  readonly expected: "offered" | "queued";
  readonly message: string;
}>() {
  constructor(args: {
    readonly offerId: string;
    readonly state: "offered" | "queued" | "sent";
    readonly expected: "offered" | "queued";
  }) {
    super({
      ...args,
      message: `Prompt queue offer ${args.offerId} is ${args.state}; expected ${args.expected}`,
    });
  }
}

export class PromptQueueDrainStateConflictError extends TaggedError(
  "PromptQueueDrainStateConflictError",
)<{
  readonly sessionRef: SessionRef;
  readonly itemId?: QueueItemId;
  readonly state: string;
  readonly message: string;
}>() {
  constructor(args: {
    readonly sessionRef: SessionRef;
    readonly itemId?: QueueItemId;
    readonly state: string;
  }) {
    super({
      ...args,
      message: `Queue drain state conflict for session ${formatSessionRef(args.sessionRef)}: ${args.state}`,
    });
  }
}

export class PromptQueueActorMismatchError extends TaggedError("PromptQueueActorMismatchError")<{
  readonly offerId: string;
  readonly message: string;
}>() {
  constructor(args: { readonly offerId: string }) {
    super({
      ...args,
      message: "Only the user who created this queued prompt can change it.",
    });
  }
}

export class PromptQueueMissingActorError extends TaggedError("PromptQueueMissingActorError")<{
  readonly operation: "add" | "interrupt";
  readonly message: string;
}>() {
  constructor(args: { readonly operation: "add" | "interrupt" }) {
    super({
      ...args,
      message: "Queued prompts can only be replayed for user messages.",
    });
  }
}

export class PromptQueueInvalidCommandError extends TaggedError("PromptQueueInvalidCommandError")<{
  readonly reason: string;
  readonly message: string;
}>() {
  constructor(args: { readonly reason: string }) {
    super({ ...args, message: args.reason });
  }
}

export class PromptQueueInjectError extends TaggedError("PromptQueueInjectError")<{
  readonly itemId: string;
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: { readonly itemId: string; readonly cause: unknown }) {
    super({
      ...args,
      message: `Failed to send queued prompt ${args.itemId}: ${describeCause(args.cause)}`,
    });
  }
}

export class PromptQueueResponseError extends TaggedError("PromptQueueResponseError")<{
  readonly operation: "offer";
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: { readonly operation: "offer"; readonly cause: unknown }) {
    super({
      ...args,
      message: `Failed to send queue ${args.operation} response: ${describeCause(args.cause)}`,
    });
  }
}
