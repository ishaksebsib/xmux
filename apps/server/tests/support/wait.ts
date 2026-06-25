import { access } from "node:fs/promises";
import { assert } from "@effect/vitest";
import { Duration, Effect } from "effect";
import { getHealth } from "./client";

export const exists = (path: string): Effect.Effect<boolean> =>
  Effect.promise(() =>
    access(path).then(
      () => true,
      () => false,
    ),
  );

export const waitUntil = <A>(input: {
  readonly label: string;
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
  readonly probe: Effect.Effect<A | undefined, unknown>;
}): Effect.Effect<A> =>
  Effect.gen(function* () {
    const timeout = input.timeoutMs ?? 2_000;
    const interval = input.intervalMs ?? 20;
    const deadline = Date.now() + timeout;
    let lastError: unknown;
    while (Date.now() <= deadline) {
      const value = yield* input.probe.pipe(
        Effect.catch((error) => {
          lastError = error;
          return Effect.void;
        }),
      );
      if (value !== undefined) return value;
      yield* Effect.sleep(Duration.millis(interval));
    }
    assert.fail(
      `Timed out waiting for ${input.label} after ${timeout}ms${lastError === undefined ? "" : `; last error: ${String(lastError)}`}`,
    );
  });

export const waitForPath = (path: string): Effect.Effect<void> =>
  waitUntil({
    label: `path: ${path}`,
    probe: exists(path).pipe(Effect.map((ok) => (ok ? true : undefined))),
  }).pipe(Effect.asVoid);

export const waitForExistingPath = (path: string): Effect.Effect<string> =>
  waitUntil({
    label: `path: ${path}`,
    probe: exists(path).pipe(Effect.map((ok) => (ok ? path : undefined))),
  });

export const waitForMissingPath = (path: string): Effect.Effect<void> =>
  waitUntil({
    label: `missing path: ${path}`,
    probe: exists(path).pipe(Effect.map((ok) => (!ok ? true : undefined))),
  }).pipe(Effect.asVoid);

export const waitForHealthReady = (
  socketPath: string,
  options?: { readonly timeoutMs?: number; readonly intervalMs?: number },
) =>
  waitUntil({
    label: `ready health on ${socketPath}`,
    timeoutMs: options?.timeoutMs,
    intervalMs: options?.intervalMs,
    probe: getHealth(socketPath).pipe(Effect.map((health) => (health.ready ? health : undefined))),
  });
