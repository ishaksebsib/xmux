import { Clock, Effect } from "effect";
import { CliServerUnreachable, CliWaitTimeout } from "../domain/errors";
import type { CliPollIntervalMs, CliTimeoutMs } from "../domain/input";
import type { CliWaitOperation } from "../domain/errors";

const makeWaitTimeout = (input: {
  readonly message: string;
  readonly operation: CliWaitOperation;
  readonly timeoutMs: CliTimeoutMs;
  readonly socketPath: string | undefined;
}): CliWaitTimeout =>
  input.socketPath === undefined
    ? new CliWaitTimeout({
        message: input.message,
        operation: input.operation,
        timeoutMs: input.timeoutMs,
      })
    : new CliWaitTimeout({
        message: input.message,
        operation: input.operation,
        timeoutMs: input.timeoutMs,
        socketPath: input.socketPath,
      });

const waitForCondition = Effect.fn("cli.waitForCondition")(function* (input: {
  readonly check: Effect.Effect<boolean, CliServerUnreachable>;
  readonly expected: boolean;
  readonly timeoutMs: CliTimeoutMs;
  readonly intervalMs: CliPollIntervalMs;
  readonly timeoutMessage: string;
  readonly operation: CliWaitOperation;
  readonly socketPath: string | undefined;
}) {
  const startedAt = yield* Clock.currentTimeMillis;

  while (true) {
    const matched = yield* input.check.pipe(
      Effect.map((value) => value === input.expected),
      Effect.catchTag("CliServerUnreachable", () => Effect.succeed(input.expected === false)),
    );
    if (matched) return;

    const now = yield* Clock.currentTimeMillis;
    if (now - startedAt >= input.timeoutMs) {
      return yield* makeWaitTimeout({
        message: input.timeoutMessage,
        operation: input.operation,
        timeoutMs: input.timeoutMs,
        socketPath: input.socketPath,
      });
    }

    yield* Effect.sleep(input.intervalMs);
  }
});

export const waitForReachable = (input: {
  readonly check: Effect.Effect<boolean, CliServerUnreachable>;
  readonly timeoutMs: CliTimeoutMs;
  readonly intervalMs: CliPollIntervalMs;
  readonly socketPath?: string;
  readonly operation?: Extract<CliWaitOperation, "start" | "restart">;
}): Effect.Effect<void, CliWaitTimeout> =>
  waitForCondition({
    check: input.check,
    expected: true,
    timeoutMs: input.timeoutMs,
    intervalMs: input.intervalMs,
    timeoutMessage: "Timed out waiting for xmux server readiness.",
    operation: input.operation ?? "start",
    socketPath: input.socketPath,
  });

export const waitForUnreachable = (input: {
  readonly check: Effect.Effect<boolean, CliServerUnreachable>;
  readonly timeoutMs: CliTimeoutMs;
  readonly intervalMs: CliPollIntervalMs;
  readonly socketPath?: string;
  readonly operation?: Extract<CliWaitOperation, "stop" | "restart">;
}): Effect.Effect<void, CliWaitTimeout> =>
  waitForCondition({
    check: input.check,
    expected: false,
    timeoutMs: input.timeoutMs,
    intervalMs: input.intervalMs,
    timeoutMessage: "Timed out waiting for xmux server shutdown.",
    operation: input.operation ?? "stop",
    socketPath: input.socketPath,
  });
