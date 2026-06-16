import { Duration, Effect, FileSystem, Logger, Path, Scope } from "effect";
import { LogEntry, type LogLevel } from "../contracts/logs";
import { LogFileError } from "../errors";
import { redactRecord, redactString, redactUnknown } from "./redaction";

export const SERVER_LOG_FILE_NAME = "server.log";
export const SERVER_ERROR_LOG_FILE_NAME = "server.error.log";
const LOG_BATCH_WINDOW = Duration.millis(100);

export interface ServerLogFilePaths {
  readonly mainLogPath: string;
  readonly errorLogPath: string;
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

const safeJsonLine = (entry: LogEntry): string => {
  try {
    const encoded = JSON.stringify(entry, (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    return encoded === undefined ? "null" : encoded;
  } catch (cause) {
    return JSON.stringify(
      LogEntry.make({
        timestamp: new Date().toISOString(),
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
    timestamp: structured.timestamp,
    level,
    message: redactUnknown(structured.message),
    ...(hasAnnotations ? { annotations } : {}),
    ...(hasSpans ? { spans } : {}),
    ...(cause === undefined ? {} : { cause: redactString(cause) }),
  });

  return { level, line: safeJsonLine(entry) };
});

const mapSetupError = (path: string, cause: unknown): LogFileError =>
  LogFileError.make({
    operation: "setup",
    path,
    message: `Failed to set up log file: ${path}`,
    cause,
  });

const ensureLogFile = (
  path: string,
): Effect.Effect<void, LogFileError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(path, "", { flag: "a", mode: 0o600 }).pipe(
      Effect.mapError((cause) => mapSetupError(path, cause)),
    );
    if (process.platform === "win32") return;
    yield* fs.chmod(path, 0o600).pipe(Effect.mapError((cause) => mapSetupError(path, cause)));
  });

const appendLogLines = (
  fs: FileSystem.FileSystem,
  path: string,
  lines: readonly string[],
): Effect.Effect<void> => {
  if (lines.length === 0) return Effect.void;
  return fs.writeFileString(path, `${lines.join("\n")}\n`, { flag: "a", mode: 0o600 }).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        process.emitWarning(`xmux failed to write log file ${path}: ${String(error)}`);
      }),
    ),
  );
};

const writeBatch = (
  fs: FileSystem.FileSystem,
  paths: ServerLogFilePaths,
  entries: readonly EncodedLogEntry[],
): Effect.Effect<void> => {
  const mainLines = entries.map((entry) => entry.line);
  const errorLines = entries
    .filter((entry) => entry.level === "error")
    .map((entry) => entry.line);

  return appendLogLines(fs, paths.mainLogPath, mainLines).pipe(
    Effect.andThen(appendLogLines(fs, paths.errorLogPath, errorLines)),
  );
};

/** Create a scoped Effect logger that writes redacted JSONL to server log files. */
export const makeFileLogger = Effect.fn("server.makeFileLogger")(function* (input: {
  readonly logDir: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const paths = resolveServerLogFilePaths(pathService, input.logDir);

  yield* ensureLogFile(paths.mainLogPath);
  yield* ensureLogFile(paths.errorLogPath);

  return yield* Logger.batched(encodeLogEntry, {
    window: LOG_BATCH_WINDOW,
    flush: (entries) => writeBatch(fs, paths, entries),
  });
});

/** Run an effect with server file logging installed and merged with existing loggers. */
export const withFileLogger = <A, E, R>(
  input: { readonly logDir: string },
  use: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | LogFileError, R | FileSystem.FileSystem | Path.Path | Scope.Scope> =>
  Effect.gen(function* () {
    const logger = yield* makeFileLogger(input);
    return yield* use.pipe(Effect.provide(Logger.layer([logger], { mergeWithExisting: true })));
  });
