import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Layer, Scope } from "effect";
import { CliResolvedServerPaths } from "../src/domain/discovery";
import { CliStartLockError } from "../src/domain/errors";
import { nodeStartLockLayer } from "../src/platform/node/start-lock";
import { StartLock } from "../src/process/start-lock";
import { parsePollIntervalMs, parseTimeoutMs } from "../src/domain/input";
import { LifecycleTiming } from "../src/process/wait";
import { makeCliSandbox, writeText } from "./support/sandbox";

const timingLayer = Layer.effect(
  LifecycleTiming,
  Effect.gen(function* () {
    const startTimeoutMs = yield* parseTimeoutMs(5).pipe(Effect.orDie);
    const stopTimeoutMs = yield* parseTimeoutMs(5).pipe(Effect.orDie);
    const pollIntervalMs = yield* parsePollIntervalMs(1).pipe(Effect.orDie);
    return { startTimeoutMs, stopTimeoutMs, pollIntervalMs };
  }),
);

const startLockLayer = nodeStartLockLayer.pipe(Layer.provide(timingLayer));

const pathsForRoot = (root: string): CliResolvedServerPaths =>
  new CliResolvedServerPaths({
    configPath: join(root, "config.jsonc"),
    stateDir: join(root, "state"),
    runtimeDir: join(root, "runtime"),
    logDir: join(root, "logs"),
    dbPath: join(root, "state", "xmux.db"),
    manifestPath: join(root, "state", "server.json"),
    startupLockPath: join(root, "state", "startup.lock"),
    socketPath: join(root, "runtime", "server.sock"),
    scopeId: "start-lock-test",
  });

const writeLockPayload = (input: {
  readonly lockPath: string;
  readonly pid: number;
  readonly scopeId: string;
  readonly nonce: string;
}): Effect.Effect<void> =>
  writeText(
    input.lockPath,
    `${JSON.stringify(
      {
        pid: input.pid,
        startedAt: "2026-06-16T00:00:00.000Z",
        scopeId: input.scopeId,
        nonce: input.nonce,
      },
      null,
      2,
    )}\n`,
  );

const pidIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && "code" in cause) {
      return cause.code !== "ESRCH";
    }
    return true;
  }
};

const findDeadPid = (): number => {
  for (let pid = 4_194_304; pid < 4_195_304; pid += 1) {
    if (!pidIsAlive(pid)) return pid;
  }
  throw new Error("Could not find a dead PID candidate for start-lock test.");
};

const withSandbox = <A, E, R>(
  run: (paths: CliResolvedServerPaths) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | Scope.Scope> =>
  Effect.gen(function* () {
    const sandbox = yield* makeCliSandbox;
    return yield* run(pathsForRoot(sandbox.root));
  });

describe("CLI start lock", () => {
  it.live("does not reclaim a lock whose PID is still alive", () =>
    withSandbox((paths) =>
      Effect.gen(function* () {
        const lockPath = `${paths.startupLockPath}.cli-start`;
        yield* writeLockPayload({
          lockPath,
          pid: process.pid,
          scopeId: paths.scopeId,
          nonce: "alive-lock",
        });

        const exit = yield* Effect.exit(
          Effect.gen(function* () {
            const startLock = yield* StartLock;
            return yield* startLock.acquire(paths);
          }).pipe(Effect.provide(startLockLayer)),
        );

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const failure = Cause.squash(exit.cause);
          expect(failure).toBeInstanceOf(CliStartLockError);
          expect(failure).toHaveProperty("reason", "busy");
        }
      }),
    ),
  );

  it.live("reclaims a stale lock only when the recorded PID is dead", () =>
    withSandbox((paths) =>
      Effect.gen(function* () {
        const lockPath = `${paths.startupLockPath}.cli-start`;
        yield* writeLockPayload({
          lockPath,
          pid: findDeadPid(),
          scopeId: paths.scopeId,
          nonce: "dead-lock",
        });

        const lock = yield* Effect.gen(function* () {
          const startLock = yield* StartLock;
          return yield* startLock.acquire(paths);
        }).pipe(Effect.provide(startLockLayer));

        expect(lock.path).toBe(lockPath);
        expect(lock.pid).toBe(process.pid);
        expect(lock.scopeId).toBe(paths.scopeId);
      }),
    ),
  );
});
