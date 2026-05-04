import { TaggedError } from "better-result";
import type { BusLifecycleState } from "./contracts";

export class UnknownMessageTypeError extends TaggedError("UnknownMessageTypeError")<{
  readonly type: string;
  readonly message: string;
}>() {
  constructor(input: { readonly type: string }) {
    super({
      ...input,
      message: `Unknown bus message type: ${input.type}`,
    });
  }
}

export class BusNotRunningError extends TaggedError("BusNotRunningError")<{
  readonly operation: "publish" | "subscribe" | "start";
  readonly status: BusLifecycleState["status"];
  readonly message: string;
}>() {
  constructor(input: {
    readonly operation: "publish" | "subscribe" | "start";
    readonly status: BusLifecycleState["status"];
  }) {
    super({
      ...input,
      message: `Cannot ${input.operation} while bus is ${input.status}`,
    });
  }
}

export class InvalidSubscriptionOptionsError extends TaggedError("InvalidSubscriptionOptionsError")<{
  readonly option: "concurrency" | "maxRetries";
  readonly value: number;
  readonly message: string;
}>() {
  constructor(input: {
    readonly option: "concurrency" | "maxRetries";
    readonly value: number;
    readonly expectation: string;
  }) {
    super({
      ...input,
      message: `Invalid subscribe option ${input.option}: expected ${input.expectation}, received ${String(input.value)}`,
    });
  }
}

export type BusStartError = BusNotRunningError;

export type BusPublishError = BusNotRunningError | UnknownMessageTypeError;

export type BusSubscribeError =
  | BusNotRunningError
  | InvalidSubscriptionOptionsError
  | UnknownMessageTypeError;
