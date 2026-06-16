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

/** Startup locks are short-lived guards around manifest/socket publication. */
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
  operation: "acquire" | "release",
): Effect.Effect<StartupLockPayload | null, StartupLockError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const raw = yield* fs.readFileString(startupLockPath).pipe(
      Effect.catchTag("PlatformError", (error) =>
        error.reason._tag === "NotFound"
          ? Effect.succeed(null)
          : Effect.fail(
              StartupLockError.make({
                operation,
                path: startupLockPath,
                message: `Failed to read startup lock: ${startupLockPath}`,
                cause: error,
              }),
            ),
      ),
    );
    if (raw === null) return null;
    return parseStartupLockPayload(raw);
  });

const serializeStartupLockPayload = (payload: StartupLockPayload): string =>
  `${JSON.stringify(payload, null, 2)}\n`;

const writeLockFile = (input: {
  readonly startupLockPath: string;
  readonly payload: StartupLockPayload;
}): Effect.Effect<boolean, StartupLockError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs
      .writeFileString(input.startupLockPath, serializeStartupLockPayload(input.payload), {
        flag: "wx",
        mode: 0o600,
      })
      .pipe(
        Effect.as(true),
        Effect.catchTag("PlatformError", (error) =>
          error.reason._tag === "AlreadyExists"
            ? Effect.succeed(false)
            : Effect.fail(
                StartupLockError.make({
                  operation: "acquire",
                  path: input.startupLockPath,
                  message: `Failed to write startup lock: ${input.startupLockPath}`,
                  cause: error,
                }),
              ),
        ),
      );
  });

const removeLockFile = (
  startupLockPath: string,
  operation: "acquire" | "release",
): Effect.Effect<void, StartupLockError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.remove(startupLockPath, { force: true }).pipe(
      Effect.mapError(
        (cause) =>
          StartupLockError.make({
            operation,
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
  const payload = StartupLockPayload.make({
    pid: process.pid,
    startedAt: clock.now().toISOString(),
    nonce,
  });
  const directory = pathService.dirname(options.startupLockPath);

  yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 }).pipe(
    Effect.mapError(
      (cause) =>
        StartupLockError.make({
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

  const existing = yield* readStartupLockPayload(options.startupLockPath, "acquire");
  if (existing !== null && !isPidAlive(existing.pid)) {
    yield* removeLockFile(options.startupLockPath, "acquire");
    if (yield* writeLockFile({ startupLockPath: options.startupLockPath, payload })) {
      return { path: options.startupLockPath, pid: process.pid, nonce };
    }
  }

  return yield* StartupLockError.make({
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
    const existing = yield* readStartupLockPayload(lock.path, "release");
    if (existing?.pid !== lock.pid || existing.nonce !== lock.nonce) return;
    yield* removeLockFile(lock.path, "release");
  });

const releaseStartupLockLogged = (lock: StartupLock): Effect.Effect<void, never, FileSystem.FileSystem> =>
  releaseStartupLock(lock).pipe(
    Effect.tapError((error) =>
      Effect.logWarning("failed to release startup lock", { error }),
    ),
    Effect.ignore,
  );

/** Acquire a scoped startup lock for tests and specialized startup workflows. */
export const acquireStartupLock = Effect.fn("server.acquireStartupLock")(function* (
  options: AcquireStartupLockOptions,
) {
  return yield* Effect.acquireRelease(acquireLockFile(options), releaseStartupLockLogged);
});

/** Bracket startup-only work so the lock is released after publication. */
export const withStartupLock = <A, E, R>(
  options: AcquireStartupLockOptions,
  use: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | StartupLockError, R | FileSystem.FileSystem | Path.Path> =>
  Effect.acquireUseRelease(
    acquireLockFile(options),
    () => use,
    releaseStartupLockLogged,
  );
