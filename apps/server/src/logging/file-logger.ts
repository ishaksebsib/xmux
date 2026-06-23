import { Duration, Effect, FileSystem, Logger, Path, References, Scope } from "effect";
import { LogEntry, type LogLevel } from "../contracts/logging";
import {
  isoTimestampFromString,
  logByteCountFromNumber,
  logRotationFileCountFromNumber,
  type LogByteCount,
  type LogRotationFileCount,
} from "../contracts/primitives";
import { LogFileError } from "../errors";
import { HostRuntime, type HostRuntimeService } from "../platform/host";
import { redactRecord, redactString, redactUnknown } from "./redaction";

export const SERVER_LOG_FILE_NAME = "server.log";
export const SERVER_ERROR_LOG_FILE_NAME = "server.error.log";
export const DEFAULT_MAX_LOG_FILE_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MAX_LOG_FILES = 5;
const LOG_BATCH_WINDOW = Duration.millis(100);
const textEncoder = new TextEncoder();

export interface ServerLogFilePaths {
  readonly mainLogPath: string;
  readonly errorLogPath: string;
}

export interface LogRotationOptions {
  readonly maxBytes?: LogByteCount;
  /** Total files per stream, including the active file. */
  readonly maxFiles?: LogRotationFileCount;
}

interface NormalizedLogRotationOptions {
  readonly maxBytes: LogByteCount;
  readonly maxFiles: LogRotationFileCount;
}

interface FileLoggerOptions extends LogRotationOptions {
  readonly logDir: string;
  readonly logLevel?: LogLevel;
}

interface EncodedLogEntry {
  readonly level: LogLevel;
  readonly line: string;
}

export const resolveServerLogFilePaths = (
  pathService: Path.Path,
  logDir: string,
): ServerLogFilePaths => ({
  mainLogPath: pathService.join(logDir, SERVER_LOG_FILE_NAME),
  errorLogPath: pathService.join(logDir, SERVER_ERROR_LOG_FILE_NAME),
});

export const rotatedLogPath = (path: string, index: number): string => `${path}.${index}`;

const parseRotation = (
  options: LogRotationOptions,
  path: string,
): Effect.Effect<NormalizedLogRotationOptions, LogFileError> => {
  const maxBytes = options.maxBytes ?? logByteCountFromNumber(DEFAULT_MAX_LOG_FILE_BYTES);
  if (!Number.isFinite(maxBytes) || maxBytes < 1) {
    return Effect.fail(
      mapLogFileError("setup", path, "Log rotation maxBytes must be greater than 0", undefined),
    );
  }

  const maxFiles = options.maxFiles ?? logRotationFileCountFromNumber(DEFAULT_MAX_LOG_FILES);
  if (!Number.isInteger(maxFiles) || maxFiles < 1) {
    return Effect.fail(
      mapLogFileError("setup", path, "Log rotation maxFiles must be a positive integer", undefined),
    );
  }

  return Effect.succeed({ maxBytes, maxFiles });
};

const byteLength = (value: string): number => textEncoder.encode(value).byteLength;

const normalizeLevel = (level: string): LogLevel => {
  switch (level.toLowerCase()) {
    case "trace":
      return "trace";
    case "debug":
      return "debug";
    case "warn":
    case "warning":
      return "warn";
    case "error":
    case "fatal":
      return "error";
    default:
      return "info";
  }
};

const toMinimumLogLevel = (level: LogLevel): "Trace" | "Debug" | "Info" | "Warn" | "Error" => {
  switch (level) {
    case "trace":
      return "Trace";
    case "debug":
      return "Debug";
    case "warn":
      return "Warn";
    case "error":
      return "Error";
    case "info":
      return "Info";
  }
};

const safeJsonLine = (entry: LogEntry): string => {
  try {
    const encoded = JSON.stringify(entry, (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    return encoded === undefined ? "null" : encoded;
  } catch (cause) {
    return JSON.stringify(
      LogEntry.make({
        timestamp: isoTimestampFromString(new Date().toISOString()),
        level: "error",
        message: "failed to encode log entry",
        cause: redactString(String(cause)),
      }),
    );
  }
};

const encodeLogEntry = Logger.make((options): EncodedLogEntry => {
  const structured = Logger.formatStructured.log(options);
  const level = normalizeLevel(structured.level);
  const annotations = redactRecord(structured.annotations);
  const spans = structured.spans;
  const cause = structured.cause;
  const hasAnnotations = Object.keys(structured.annotations).length > 0;
  const hasSpans = Object.keys(spans).length > 0;

  const entry = LogEntry.make({
    timestamp: isoTimestampFromString(structured.timestamp),
    level,
    message: redactUnknown(structured.message),
    ...(hasAnnotations ? { annotations } : {}),
    ...(hasSpans ? { spans } : {}),
    ...(cause === undefined ? {} : { cause: redactString(cause) }),
  });

  return { level, line: safeJsonLine(entry) };
});

const mapLogFileError = (
  operation: "setup" | "read" | "write",
  path: string,
  message: string,
  cause: unknown,
): LogFileError =>
  LogFileError.make({
    operation,
    path,
    message,
    cause,
  });

const ensureLogFile = (
  path: string,
): Effect.Effect<void, LogFileError, FileSystem.FileSystem | HostRuntime> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const host = yield* HostRuntime;
    yield* fs
      .writeFileString(path, "", { flag: "a", mode: 0o600 })
      .pipe(
        Effect.mapError((cause) =>
          mapLogFileError("setup", path, `Failed to set up log file: ${path}`, cause),
        ),
      );
    if (host.platform === "win32") return;
    yield* fs
      .chmod(path, 0o600)
      .pipe(
        Effect.mapError((cause) =>
          mapLogFileError("setup", path, `Failed to secure log file: ${path}`, cause),
        ),
      );
  });

const fileSize = (fs: FileSystem.FileSystem, path: string): Effect.Effect<number, LogFileError> =>
  fs.stat(path).pipe(
    Effect.map((info) => Number(info.size)),
    Effect.catchTag("PlatformError", (error) =>
      error.reason._tag === "NotFound"
        ? Effect.succeed(0)
        : Effect.fail(
            mapLogFileError("write", path, `Failed to stat log file for rotation: ${path}`, error),
          ),
    ),
  );

const removeIfExists = (
  fs: FileSystem.FileSystem,
  path: string,
): Effect.Effect<void, LogFileError> =>
  fs
    .remove(path, { force: true })
    .pipe(
      Effect.mapError((cause) =>
        mapLogFileError("write", path, `Failed to remove rotated log file: ${path}`, cause),
      ),
    );

const renameIfExists = (
  fs: FileSystem.FileSystem,
  from: string,
  to: string,
): Effect.Effect<void, LogFileError> =>
  fs
    .rename(from, to)
    .pipe(
      Effect.catchTag("PlatformError", (error) =>
        error.reason._tag === "NotFound"
          ? Effect.void
          : Effect.fail(
              mapLogFileError("write", from, `Failed to rotate log file: ${from} -> ${to}`, error),
            ),
      ),
    );

const rotateLogFile = (
  fs: FileSystem.FileSystem,
  path: string,
  rotation: NormalizedLogRotationOptions,
): Effect.Effect<void, LogFileError> =>
  Effect.gen(function* () {
    if (rotation.maxFiles <= 1) {
      yield* removeIfExists(fs, path);
      return;
    }

    const oldestIndex = rotation.maxFiles - 1;
    yield* removeIfExists(fs, rotatedLogPath(path, oldestIndex));
    for (let index = oldestIndex - 1; index >= 1; index -= 1) {
      yield* renameIfExists(fs, rotatedLogPath(path, index), rotatedLogPath(path, index + 1));
    }
    yield* renameIfExists(fs, path, rotatedLogPath(path, 1));
  });

const rotateIfNeeded = (
  fs: FileSystem.FileSystem,
  path: string,
  nextBytes: number,
  rotation: NormalizedLogRotationOptions,
): Effect.Effect<void, LogFileError> =>
  Effect.gen(function* () {
    const size = yield* fileSize(fs, path);
    if (size === 0 || size + nextBytes <= rotation.maxBytes) return;
    yield* rotateLogFile(fs, path, rotation);
  });

const appendLogLine = (
  fs: FileSystem.FileSystem,
  path: string,
  line: string,
  rotation: NormalizedLogRotationOptions,
): Effect.Effect<void, LogFileError> => {
  const data = `${line}\n`;
  return rotateIfNeeded(fs, path, byteLength(data), rotation).pipe(
    Effect.andThen(
      fs
        .writeFileString(path, data, { flag: "a", mode: 0o600 })
        .pipe(
          Effect.mapError((cause) =>
            mapLogFileError("write", path, `Failed to append log file: ${path}`, cause),
          ),
        ),
    ),
  );
};

const appendLogLines = (
  host: HostRuntimeService,
  fs: FileSystem.FileSystem,
  path: string,
  lines: readonly string[],
  rotation: NormalizedLogRotationOptions,
): Effect.Effect<void> => {
  if (lines.length === 0) return Effect.void;
  return Effect.forEach(lines, (line) => appendLogLine(fs, path, line, rotation), {
    discard: true,
  }).pipe(
    Effect.catch((error) =>
      host.emitWarning(`xmux failed to write log file ${path}: ${String(error)}`),
    ),
  );
};

const writeBatch = (
  host: HostRuntimeService,
  fs: FileSystem.FileSystem,
  paths: ServerLogFilePaths,
  rotation: NormalizedLogRotationOptions,
  entries: readonly EncodedLogEntry[],
): Effect.Effect<void> => {
  const mainLines = entries.map((entry) => entry.line);
  const errorLines = entries.filter((entry) => entry.level === "error").map((entry) => entry.line);

  return appendLogLines(host, fs, paths.mainLogPath, mainLines, rotation).pipe(
    Effect.andThen(appendLogLines(host, fs, paths.errorLogPath, errorLines, rotation)),
  );
};

/** Create a scoped Effect logger that writes redacted JSONL to server log files. */
export const makeFileLogger = Effect.fn("server.makeFileLogger")(function* (
  input: FileLoggerOptions,
) {
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const host = yield* HostRuntime;
  const paths = resolveServerLogFilePaths(pathService, input.logDir);
  const rotation = yield* parseRotation(input, input.logDir);

  yield* ensureLogFile(paths.mainLogPath);
  yield* ensureLogFile(paths.errorLogPath);

  return yield* Logger.batched(encodeLogEntry, {
    window: LOG_BATCH_WINDOW,
    flush: (entries) => writeBatch(host, fs, paths, rotation, entries),
  });
});

/** Run an effect with server file logging installed and merged with existing loggers. */
export const withFileLogger = <A, E, R>(
  input: FileLoggerOptions,
  use: Effect.Effect<A, E, R>,
): Effect.Effect<
  A,
  E | LogFileError,
  R | FileSystem.FileSystem | Path.Path | HostRuntime | Scope.Scope
> =>
  Effect.gen(function* () {
    const logger = yield* makeFileLogger(input);
    return yield* use.pipe(
      Effect.provide(Logger.layer([logger], { mergeWithExisting: true })),
      Effect.provideService(
        References.MinimumLogLevel,
        toMinimumLogLevel(input.logLevel ?? "info"),
      ),
    );
  });
