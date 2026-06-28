import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Effect, Layer, Option, Schedule, Schema } from "effect";
import type { CliResolvedServerPaths } from "../../domain/discovery";
import { CliStartLockError } from "../../domain/errors";
import {
  StartLock,
  type CliStartLockHandle,
  type StartLockService,
} from "../../process/start-lock";
import { LifecycleTiming } from "../../process/wait";

class CliStartLockPayload extends Schema.Class<CliStartLockPayload>("CliStartLockPayload")({
  pid: Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThan(0)),
  startedAt: Schema.String,
  scopeId: Schema.String,
  nonce: Schema.String,
}) {}

const decodeJsonOption = Schema.decodeUnknownOption(Schema.UnknownFromJsonString);
const decodePayloadOption = Schema.decodeUnknownOption(CliStartLockPayload);

type ParsedLockPayload =
  | { readonly _tag: "Valid"; readonly payload: CliStartLockPayload }
  | { readonly _tag: "Invalid" };

const lockPathFor = (paths: CliResolvedServerPaths): string => `${paths.startupLockPath}.cli-start`;

const nodeErrorCode = (cause: unknown): string | undefined => {
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return undefined;
  const code = cause.code;
  return typeof code === "string" ? code : undefined;
};

const parseLockPayload = (raw: string): ParsedLockPayload =>
  Option.match(decodeJsonOption(raw), {
    onNone: () => ({ _tag: "Invalid" }),
    onSome: (json) =>
      Option.match(decodePayloadOption(json), {
        onNone: () => ({ _tag: "Invalid" }),
        onSome: (payload) => ({ _tag: "Valid", payload }),
      }),
  });

const serializeLockPayload = (payload: CliStartLockPayload): string =>
  `${JSON.stringify(payload, null, 2)}\n`;

const isPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return nodeErrorCode(cause) !== "ESRCH";
  }
};

const readExistingLock = (
  lockPath: string,
): Effect.Effect<CliStartLockPayload | null, CliStartLockError> =>
  Effect.tryPromise({
    try: () => readFile(lockPath, "utf8"),
    catch: (cause) =>
      new CliStartLockError({
        message: `Failed to read xmux CLI startup lock: ${lockPath}`,
        lockPath,
        reason: "read-failed",
        cause,
      }),
  }).pipe(
    Effect.flatMap((raw) => {
      const parsed = parseLockPayload(raw);
      return parsed._tag === "Valid"
        ? Effect.succeed(parsed.payload)
        : Effect.fail(
            new CliStartLockError({
              message: `xmux CLI startup lock is invalid and will not be reclaimed automatically: ${lockPath}`,
              lockPath,
              reason: "invalid-lock",
            }),
          );
    }),
    Effect.catchIf(
      (error) => error.reason === "read-failed" && nodeErrorCode(error.cause) === "ENOENT",
      () => Effect.succeed(null),
    ),
  );

const writeLockFile = (input: {
  readonly lockPath: string;
  readonly payload: CliStartLockPayload;
}): Effect.Effect<boolean, CliStartLockError> =>
  Effect.tryPromise({
    try: () =>
      writeFile(input.lockPath, serializeLockPayload(input.payload), {
        flag: "wx",
        mode: 0o600,
      }),
    catch: (cause) =>
      new CliStartLockError({
        message: `Failed to write xmux CLI startup lock: ${input.lockPath}`,
        lockPath: input.lockPath,
        reason: "write-failed",
        cause,
      }),
  }).pipe(
    Effect.as(true),
    Effect.catchIf(
      (error) => error.reason === "write-failed" && nodeErrorCode(error.cause) === "EEXIST",
      () => Effect.succeed(false),
    ),
  );

const removeLockFile = (lockPath: string): Effect.Effect<void, CliStartLockError> =>
  Effect.tryPromise({
    try: () => rm(lockPath, { force: true }),
    catch: (cause) =>
      new CliStartLockError({
        message: `Failed to remove xmux CLI startup lock: ${lockPath}`,
        lockPath,
        reason: "remove-failed",
        cause,
      }),
  });

const createLockDirectory = (lockPath: string): Effect.Effect<void, CliStartLockError> =>
  Effect.tryPromise({
    try: () => mkdir(dirname(lockPath), { recursive: true, mode: 0o700 }),
    catch: (cause) =>
      new CliStartLockError({
        message: `Failed to create xmux CLI startup lock directory: ${dirname(lockPath)}`,
        lockPath,
        reason: "write-failed",
        cause,
      }),
  }).pipe(Effect.asVoid);

const acquireLockFile = Effect.fn("cli.startLock.acquireLockFile")(function* (
  paths: CliResolvedServerPaths,
) {
  const lockPath = lockPathFor(paths);
  const payload = new CliStartLockPayload({
    pid: process.pid,
    startedAt: new Date().toISOString(),
    scopeId: paths.scopeId,
    nonce: randomUUID(),
  });

  yield* createLockDirectory(lockPath);

  if (yield* writeLockFile({ lockPath, payload })) {
    return { path: lockPath, pid: payload.pid, nonce: payload.nonce, scopeId: payload.scopeId };
  }

  const existing = yield* readExistingLock(lockPath);
  if (existing !== null && !isPidAlive(existing.pid)) {
    yield* removeLockFile(lockPath);
    if (yield* writeLockFile({ lockPath, payload })) {
      return { path: lockPath, pid: payload.pid, nonce: payload.nonce, scopeId: payload.scopeId };
    }
  }

  return yield* new CliStartLockError({
    message: "Another xmux server startup is already in progress.",
    lockPath,
    reason: "busy",
  });
});

const releaseLockFile = (lock: CliStartLockHandle): Effect.Effect<void, CliStartLockError> =>
  Effect.gen(function* () {
    const existing = yield* readExistingLock(lock.path).pipe(
      Effect.catchIf(
        (error) => error.reason === "invalid-lock" || error.reason === "read-failed",
        () => Effect.succeed(null),
      ),
    );
    if (existing?.pid !== lock.pid || existing.nonce !== lock.nonce) return;
    yield* removeLockFile(lock.path);
  });

const releaseLockLogged = (lock: CliStartLockHandle): Effect.Effect<void> =>
  releaseLockFile(lock).pipe(
    Effect.tapError((error) =>
      Effect.logWarning("failed to release xmux CLI startup lock", { error }),
    ),
    Effect.ignore,
  );

const makeStartLock = Effect.fn("cli.startLock.make")(function* () {
  const timing = yield* LifecycleTiming;
  const retrySchedule = Schedule.spaced(timing.pollIntervalMs).pipe(
    Schedule.both(Schedule.during(timing.startTimeoutMs)),
  );

  const acquire = (paths: CliResolvedServerPaths) =>
    acquireLockFile(paths).pipe(
      Effect.retry({
        while: (error) => error.reason === "busy",
        schedule: retrySchedule,
      }),
    );

  const withLock: StartLockService["withLock"] = (paths, use) =>
    Effect.acquireUseRelease(acquire(paths), () => use, releaseLockLogged);

  return {
    acquire,
    release: releaseLockLogged,
    withLock,
  };
});

export const nodeStartLockLayer = Layer.effect(StartLock, makeStartLock());
