import { Result } from "better-result";
import { ChatLifecycleError, type ChatLifecycleOperation } from "./errors";

export type ChatLifecycleState =
  | { readonly status: "created" }
  | { readonly status: "starting" }
  | { readonly status: "started" }
  | { readonly status: "closing" }
  | { readonly status: "closed" };

export const initialChatLifecycleState = { status: "created" } satisfies ChatLifecycleState;

/**
 * `start()` is intentionally not idempotent: a second call returns an error
 * so lifecycle ownership bugs are visible to production callers.
 */
export function ensureCanStart(state: ChatLifecycleState): Result<void, ChatLifecycleError> {
  return state.status === "created"
    ? Result.ok()
    : Result.err(
        new ChatLifecycleError({
          operation: "start",
          currentState: state.status,
          expectedState: "created",
        }),
      );
}

/** Sending and replying require fully started adapters. */
export function ensureStarted(args: {
  readonly state: ChatLifecycleState;
  readonly operation: Extract<ChatLifecycleOperation, "sendMessage" | "reply">;
}): Result<void, ChatLifecycleError> {
  return args.state.status === "started"
    ? Result.ok()
    : Result.err(
        new ChatLifecycleError({
          operation: args.operation,
          currentState: args.state.status,
          expectedState: "started",
        }),
      );
}

/** Closing is valid after creation or startup, but never while transitioning. */
export function ensureCanClose(state: ChatLifecycleState): Result<void, ChatLifecycleError> {
  return state.status === "created" || state.status === "started"
    ? Result.ok()
    : Result.err(
        new ChatLifecycleError({
          operation: "close",
          currentState: state.status,
          expectedState: "created|started",
        }),
      );
}
