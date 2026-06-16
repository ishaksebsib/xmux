import { Context, Effect, FileSystem, Layer, Option, Path, Schema, Scope } from "effect";
import { CONTROL_RESPONSE_VERSION } from "../contracts/control";
import { LogEntry, LogsResponse } from "../contracts/logs";
import { LogFileError } from "../errors";
import { resolveServerLogFilePaths } from "./file-logger";

const DEFAULT_TAIL = 200;
const MAX_TAIL = 1000;
const MAX_READ_BYTES = 256 * 1024;
const decodeUnknownJsonOption = Schema.decodeUnknownOption(Schema.UnknownFromJsonString);
const decodeLogEntry = Schema.decodeUnknownOption(LogEntry);

export interface ReadServerLogTailInput {
  readonly logDir: string;
  readonly tail?: number;
  readonly maxTail?: number;
  readonly maxBytes?: number;
}

const clampTail = (tail: number | undefined, maxTail: number): number => {
  if (tail === undefined || !Number.isInteger(tail) || tail < 1) return DEFAULT_TAIL;
  return Math.min(tail, maxTail);
};

const decodeLine = (line: string): LogEntry | null => {
  const json = decodeUnknownJsonOption(line);
  if (Option.isNone(json)) return null;
  const decoded = decodeLogEntry(json.value);
  return Option.isSome(decoded) ? decoded.value : null;
};

const parseLogLines = (raw: string, tail: number): readonly LogEntry[] => {
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  const entries: LogEntry[] = [];
  for (const line of lines) {
    const entry = decodeLine(line);
    if (entry !== null) entries.push(entry);
  }
  return entries.slice(-tail);
};

const readBoundedFileTail = (
  path: string,
  maxBytes: number,
): Effect.Effect<string, LogFileError, FileSystem.FileSystem | Scope.Scope> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const file = yield* fs.open(path, { flag: "r" }).pipe(
      Effect.catchTag("PlatformError", (error) =>
        error.reason._tag === "NotFound"
          ? Effect.succeed(null)
          : Effect.fail(
              LogFileError.make({
                operation: "read",
                path,
                message: `Failed to open log file: ${path}`,
                cause: error,
              }),
            ),
      ),
    );
    if (file === null) return "";

    const info = yield* file.stat.pipe(
      Effect.mapError((cause) =>
        LogFileError.make({
          operation: "read",
          path,
          message: `Failed to stat log file: ${path}`,
          cause,
        }),
      ),
    );
    const fileSize = Number(info.size);
    const bytesToRead = Math.min(Math.max(maxBytes, 0), Math.max(fileSize, 0));
    if (bytesToRead === 0) return "";

    const offset = Math.max(fileSize - bytesToRead, 0);
    yield* file.seek(offset, "start").pipe(
      Effect.mapError((cause) =>
        LogFileError.make({
          operation: "read",
          path,
          message: `Failed to seek log file: ${path}`,
          cause,
        }),
      ),
    );
    const chunk = yield* file.readAlloc(bytesToRead).pipe(
      Effect.mapError((cause) =>
        LogFileError.make({
          operation: "read",
          path,
          message: `Failed to read log file: ${path}`,
          cause,
        }),
      ),
    );
    if (Option.isNone(chunk)) return "";

    const text = new TextDecoder().decode(chunk.value);
    if (offset === 0) return text;
    const newlineIndex = text.indexOf("\n");
    return newlineIndex < 0 ? text : text.slice(newlineIndex + 1);
  });

/** Read a bounded tail from the main server log and decode schema-valid entries. */
export const readServerLogTail = Effect.fn("server.readServerLogTail")(function* (
  input: ReadServerLogTailInput,
) {
  const pathService = yield* Path.Path;
  const paths = resolveServerLogFilePaths(pathService, input.logDir);
  const tail = clampTail(input.tail, input.maxTail ?? MAX_TAIL);
  const raw = yield* Effect.scoped(
    readBoundedFileTail(paths.mainLogPath, input.maxBytes ?? MAX_READ_BYTES),
  );

  return LogsResponse.make({
    version: CONTROL_RESPONSE_VERSION,
    entries: parseLogLines(raw, tail),
  });
});

/** LogReader captures platform services for route handlers outside the main fiber. */
export class LogReader extends Context.Service<
  LogReader,
  {
    readonly readTail: (input: ReadServerLogTailInput) => Effect.Effect<LogsResponse, LogFileError>;
  }
>()("@xmux/server/LogReader") {}

export const LogReaderLive = Layer.effect(LogReader)(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;

    return {
      readTail: (input: ReadServerLogTailInput) =>
        readServerLogTail(input).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, pathService),
        ),
    };
  }),
);
