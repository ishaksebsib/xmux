import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, layer } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import { LogEntry } from "../src/contracts/logging";
import {
  resolveServerLogFilePaths,
  rotatedLogPath,
  withFileLogger,
} from "../src/logging/file-logger";
import { readServerLogTail } from "../src/logging/log-reader";
import { redactUnknown } from "../src/logging/redaction";
import type { HostRuntime } from "../src/platform/host";
import { NodeHostRuntime } from "../src/platform/node";

const NodeFsPathLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, NodeHostRuntime);
const decodeUnknownJsonOption = Schema.decodeUnknownOption(Schema.UnknownFromJsonString);
const decodeLogEntry = Schema.decodeUnknownOption(LogEntry);

const withTempLogDir = <A, E, R>(
  use: (input: {
    readonly root: string;
    readonly logDir: string;
    readonly paths: ReturnType<typeof resolveServerLogFilePaths>;
  }) => Effect.Effect<A, E, R | FileSystem.FileSystem | Path.Path | HostRuntime>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "server-logs-" });
    const logDir = pathService.join(root, "logs");
    yield* fs.makeDirectory(logDir, { recursive: true, mode: 0o700 });
    return yield* use({ root, logDir, paths: resolveServerLogFilePaths(pathService, logDir) });
  });

const decodeJsonLine = (line: string): LogEntry => {
  const json = decodeUnknownJsonOption(line);
  if (json._tag === "None") assert.fail("Expected JSON log line");
  const decoded = decodeLogEntry(json.value);
  if (decoded._tag === "None") assert.fail("Expected schema-valid log line");
  return decoded.value;
};

describe("structured file logging", () => {
  layer(NodeFsPathLayer)((it) => {
    it.effect("writes redacted JSONL to main and error logs", () =>
      withTempLogDir(({ logDir, paths }) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;

          yield* Effect.scoped(
            withFileLogger(
              { logDir },
              Effect.gen(function* () {
                yield* Effect.logInfo("telegram adapter starting", {
                  token: "telegram-secret",
                  nested: { authorization: "Bearer discord-secret" },
                });
                yield* Effect.logError("adapter failed", { password: "pw-secret" });
              }),
            ),
          );

          const mainLog = yield* fs.readFileString(paths.mainLogPath);
          const errorLog = yield* fs.readFileString(paths.errorLogPath);
          assert.include(mainLog, "telegram adapter starting");
          assert.include(mainLog, "adapter failed");
          assert.include(errorLog, "adapter failed");
          assert.notInclude(mainLog, "telegram-secret");
          assert.notInclude(mainLog, "discord-secret");
          assert.notInclude(errorLog, "pw-secret");

          const firstLine = mainLog.split("\n").find((line) => line.trim().length > 0);
          if (firstLine === undefined) assert.fail("Expected at least one log line");
          const decoded = decodeJsonLine(firstLine);
          assert.oneOf(decoded.level, ["info", "error"]);
        }),
      ),
    );

    it.effect("respects configured minimum log level", () =>
      withTempLogDir(({ logDir, paths }) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;

          yield* Effect.scoped(
            withFileLogger(
              { logDir, logLevel: "warn" },
              Effect.gen(function* () {
                yield* Effect.logInfo("filtered info");
                yield* Effect.logWarning("kept warning");
                yield* Effect.logError("kept error");
              }),
            ),
          );

          const mainLog = yield* fs.readFileString(paths.mainLogPath);
          assert.notInclude(mainLog, "filtered info");
          assert.include(mainLog, "kept warning");
          assert.include(mainLog, "kept error");
        }),
      ),
    );

    it.effect("rotates logs by size and tails across rotated files", () =>
      withTempLogDir(({ logDir, paths }) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;

          yield* Effect.scoped(
            withFileLogger(
              { logDir, maxBytes: 320, maxFiles: 3 },
              Effect.gen(function* () {
                for (let index = 0; index < 10; index += 1) {
                  yield* Effect.logInfo(`rotation-${index}`, { payload: "x".repeat(160) });
                }
              }),
            ),
          );

          assert.isTrue(yield* fs.exists(paths.mainLogPath));
          assert.isTrue(yield* fs.exists(rotatedLogPath(paths.mainLogPath, 1)));
          assert.isTrue(yield* fs.exists(rotatedLogPath(paths.mainLogPath, 2)));
          assert.isFalse(yield* fs.exists(rotatedLogPath(paths.mainLogPath, 3)));

          const entries = yield* readServerLogTail({
            logDir,
            tail: 3,
            maxFiles: 3,
            maxBytes: 5_000,
          });
          assert.lengthOf(entries, 3);
          assert.deepStrictEqual(entries[0]?.message, ["rotation-7", { payload: "x".repeat(160) }]);
          assert.deepStrictEqual(entries[1]?.message, ["rotation-8", { payload: "x".repeat(160) }]);
          assert.deepStrictEqual(entries[2]?.message, ["rotation-9", { payload: "x".repeat(160) }]);
        }),
      ),
    );

    it.effect("tails latest schema-valid entries from bounded log files", () =>
      withTempLogDir(({ paths, logDir }) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const lines = [
            LogEntry.make({
              timestamp: "2026-06-16T00:00:00.000Z",
              level: "info",
              message: "one",
            }),
            LogEntry.make({
              timestamp: "2026-06-16T00:00:01.000Z",
              level: "warn",
              message: "two",
            }),
            LogEntry.make({
              timestamp: "2026-06-16T00:00:02.000Z",
              level: "error",
              message: "three",
            }),
          ].map((entry) => JSON.stringify(entry));
          yield* fs.writeFileString(paths.mainLogPath, `not-json\n${lines.join("\n")}\n`);

          const entries = yield* readServerLogTail({ logDir, tail: 2 });
          assert.lengthOf(entries, 2);
          assert.strictEqual(entries[0]?.message, "two");
          assert.strictEqual(entries[1]?.message, "three");
        }),
      ),
    );

    it.effect("redacts nested secret-looking fields", () =>
      Effect.sync(() => {
        const redacted = redactUnknown({
          ok: true,
          apiKey: "do-not-log",
          nested: { clientSecret: "also-secret" },
          header: "Authorization: Bearer raw-token",
        });
        const text = JSON.stringify(redacted);
        assert.include(text, "[redacted]");
        assert.notInclude(text, "do-not-log");
        assert.notInclude(text, "also-secret");
        assert.notInclude(text, "raw-token");
      }),
    );
  });
});
