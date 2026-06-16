import { randomUUID } from "node:crypto";
import { Effect, FileSystem, Option, Path, Schema } from "effect";
import { StartupLockError } from "../errors";
import { SystemServerClock, type ServerClock } from "../options";
import { isPidAlive } from "./pid";

class StartupLockPayload extends Schema.Class<StartupLockPayload>("StartupLockPayload")({
  pid: Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThan(0)),
  startedAt: Schema.String,
  nonce: Schema.String,
}) {}

const decodeUnknownJsonOption = Schema.decodeUnknownOption(Schema.UnknownFromJsonString);
const decodeStartupLockPayload = Schema.decodeUnknownOption(StartupLockPayload);

/** Startup locks are scoped so duplicate foreground starts cannot race silently. */
export interface StartupLock {
  readonly path: string;
  readonly pid: number;
  readonly nonce: string;
}

/** Lock options include seams for deterministic tests without changing ownership logic. */
export interface AcquireStartupLockOptions {
  readonly startupLockPath: string;
  readonly clock?: ServerClock;
  readonly nonce?: string;
}

const parseStartupLockPayload = (raw: string): StartupLockPayload | null => {
  const json = decodeUnknownJsonOption(raw);
  if (Option.isNone(json)) return null;
  const decoded = decodeStartupLockPayload(json.value);
  return Option.isSome(decoded) ? decoded.value : null;
};

const readStartupLockPayload = (
  startupLockPath: string,
): Effect.Effect<StartupLockPayload | null, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const raw = yield* fs
      .readFileString(startupLockPath)
      .pipe(Effect.catchCause(() => Effect.succeed(null)));
    if (raw === null) return null;
    return parseStartupLockPayload(raw);
  });

const serializeStartupLockPayload = (payload: StartupLockPayload): string =>
  `${JSON.stringify(payload, null, 2)}\n`;

const writeLockFile = (input: {
  readonly startupLockPath: string;
  readonly payload: StartupLockPayload;
}): Effect.Effect<boolean, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs
      .writeFileString(input.startupLockPath, serializeStartupLockPayload(input.payload), {
        flag: "wx",
        mode: 0o600,
      })
      .pipe(
        Effect.map(() => true),
        Effect.catchCause(() => Effect.succeed(false)),
      );
  });

const removeLockFile = (
  startupLockPath: string,
): Effect.Effect<void, StartupLockError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.remove(startupLockPath, { force: true }).pipe(
      Effect.mapError(
        (cause) =>
          new StartupLockError({
            operation: "release",
            path: startupLockPath,
            message: `Failed to remove startup lock: ${startupLockPath}`,
            cause,
          }),
      ),
    );
  });

const acquireLockFile = Effect.fn("server.acquireStartupLockFile")(function* (
  options: AcquireStartupLockOptions,
) {
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const clock = options.clock ?? SystemServerClock;
  const nonce = options.nonce ?? randomUUID();
  const payload = new StartupLockPayload({
    pid: process.pid,
    startedAt: clock.now().toISOString(),
    nonce,
  });
  const directory = pathService.dirname(options.startupLockPath);

  yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 }).pipe(
    Effect.mapError(
      (cause) =>
        new StartupLockError({
          operation: "acquire",
          path: options.startupLockPath,
          message: `Failed to create startup lock directory: ${directory}`,
          cause,
        }),
    ),
  );

  if (yield* writeLockFile({ startupLockPath: options.startupLockPath, payload })) {
    return { path: options.startupLockPath, pid: process.pid, nonce };
  }

  const existing = yield* readStartupLockPayload(options.startupLockPath);
  if (existing !== null && !isPidAlive(existing.pid)) {
    yield* removeLockFile(options.startupLockPath).pipe(
      Effect.mapError(
        (error) =>
          new StartupLockError({
            operation: "acquire",
            path: options.startupLockPath,
            message: error.message,
            cause: error,
          }),
      ),
    );
    if (yield* writeLockFile({ startupLockPath: options.startupLockPath, payload })) {
      return { path: options.startupLockPath, pid: process.pid, nonce };
    }
  }

  return yield* new StartupLockError({
    operation: "acquire",
    path: options.startupLockPath,
    message: "Another server startup is already in progress.",
  });
});

/** Release removes only the lock with the matching PID and nonce. */
export const releaseStartupLock = (
  lock: StartupLock,
): Effect.Effect<void, StartupLockError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const existing = yield* readStartupLockPayload(lock.path);
    if (existing?.pid !== lock.pid || existing.nonce !== lock.nonce) return;
    yield* removeLockFile(lock.path);
  });

/** Acquire a startup lock with exclusive file creation and stale-PID reclaim. */
export const acquireStartupLock = Effect.fn("server.acquireStartupLock")(function* (
  options: AcquireStartupLockOptions,
) {
  return yield* Effect.acquireRelease(
    acquireLockFile(options),
    (lock) => releaseStartupLock(lock).pipe(Effect.ignore),
  );
});
