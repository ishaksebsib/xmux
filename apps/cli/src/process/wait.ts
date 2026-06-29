import { Clock, Context, Effect, Layer } from "effect";
import { CliServerUnreachable, CliWaitTimeout } from "../domain/errors";
import {
  parsePollIntervalMs,
  parseTimeoutMs,
  type CliPollIntervalMs,
  type CliTimeoutMs,
} from "../domain/input";
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

const waitForCondition = <E>(input: {
  readonly check: Effect.Effect<boolean, CliServerUnreachable | E>;
  readonly expected: boolean;
  readonly timeoutMs: CliTimeoutMs;
  readonly intervalMs: CliPollIntervalMs;
  readonly timeoutMessage: string;
  readonly operation: CliWaitOperation;
  readonly socketPath: string | undefined;
}): Effect.Effect<void, CliWaitTimeout | E> =>
  Effect.gen(function* () {
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

export const waitForReachable = <E>(input: {
  readonly check: Effect.Effect<boolean, CliServerUnreachable | E>;
  readonly timeoutMs: CliTimeoutMs;
  readonly intervalMs: CliPollIntervalMs;
  readonly socketPath?: string;
  readonly operation?: Extract<CliWaitOperation, "start" | "restart">;
  readonly timeoutMessage?: string;
}): Effect.Effect<void, CliWaitTimeout | E> =>
  waitForCondition({
    check: input.check,
    expected: true,
    timeoutMs: input.timeoutMs,
    intervalMs: input.intervalMs,
    timeoutMessage: input.timeoutMessage ?? "Timed out waiting for xmux server readiness.",
    operation: input.operation ?? "start",
    socketPath: input.socketPath,
  });

export const waitForUnreachable = <E>(input: {
  readonly check: Effect.Effect<boolean, CliServerUnreachable | E>;
  readonly timeoutMs: CliTimeoutMs;
  readonly intervalMs: CliPollIntervalMs;
  readonly socketPath?: string;
  readonly operation?: Extract<CliWaitOperation, "stop" | "restart">;
}): Effect.Effect<void, CliWaitTimeout | E> =>
  waitForCondition({
    check: input.check,
    expected: false,
    timeoutMs: input.timeoutMs,
    intervalMs: input.intervalMs,
    timeoutMessage: "Timed out waiting for xmux server shutdown.",
    operation: input.operation ?? "stop",
    socketPath: input.socketPath,
  });

export interface LifecycleTimingService {
  readonly startTimeoutMs: CliTimeoutMs;
  readonly stopTimeoutMs: CliTimeoutMs;
  readonly pollIntervalMs: CliPollIntervalMs;
}

const DEFAULT_START_TIMEOUT_MS = 60_000;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;
const DEFAULT_POLL_INTERVAL_MS = 50;

const makeLifecycleTiming = Effect.gen(function* () {
  const startTimeoutMs = yield* parseTimeoutMs(DEFAULT_START_TIMEOUT_MS).pipe(Effect.orDie);
  const stopTimeoutMs = yield* parseTimeoutMs(DEFAULT_STOP_TIMEOUT_MS).pipe(Effect.orDie);
  const pollIntervalMs = yield* parsePollIntervalMs(DEFAULT_POLL_INTERVAL_MS).pipe(Effect.orDie);

  return {
    startTimeoutMs,
    stopTimeoutMs,
    pollIntervalMs,
  };
});

export class LifecycleTiming extends Context.Service<LifecycleTiming, LifecycleTimingService>()(
  "@xmux/cli/LifecycleTiming",
) {
  static readonly layer = Layer.effect(LifecycleTiming, makeLifecycleTiming);
}
