import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { assert, describe, layer } from "@effect/vitest";
import { defineChatAdapter } from "@xmux/chat-core";
import { defineHarnessAdapter } from "@xmux/harness-core";
import { Result, createInMemoryStore } from "@xmux/orchestrator";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import {
  isoTimestampFromString,
  logByteCountFromNumber,
  logRotationFileCountFromNumber,
} from "../src/contracts/primitives";
import { LogEntry } from "../src/contracts/logging";
import {
  resolveServerLogFilePaths,
  rotatedLogPath,
  withFileLogger,
} from "../src/logging/file-logger";
import { readServerLogTail } from "../src/logging/log-reader";
import { redactUnknown } from "../src/logging/redaction";
import { makeOrchestratorLogger } from "../src/orchestrator/logger";
import { createXmuxRuntime } from "../src/orchestrator/runtime";
import type { HostRuntime } from "../src/platform/host";
import { nodeHostRuntimeLayer } from "../src/platform/node";

const nodeFsPathLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, nodeHostRuntimeLayer);
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

const testChatAdapter = defineChatAdapter<"test-chat">({
  id: "test-chat",
  capabilities: {
    messages: {
      send: true,
      reply: true,
      edit: false,
      delete: false,
      typing: false,
      markdown: false,
      attachments: { receive: false, send: false, download: false },
    },
  },
  async open() {
    return Result.ok({
      id: "test-chat",
      async start() {
        return Result.ok();
      },
      async sendMessage(input) {
        return Result.ok({
          chatId: "test-chat",
          conversationId: input.conversationId,
          messageId: "test-message",
          text: input.text,
          format: input.format,
          adapterData: {},
        });
      },
      async sendAction(input) {
        return Result.ok({
          chatId: "test-chat",
          conversationId: input.conversationId,
          messageId: "test-action",
          text: input.text,
          format: input.format,
          adapterData: {},
        });
      },
      async respondToAction() {
        return Result.ok();
      },
      async close() {},
    });
  },
});

const testHarnessAdapter = defineHarnessAdapter<"test-harness">({
  id: "test-harness",
  async open() {
    const unsupported = async () => Result.err(new Error("not used by logging test"));
    return Result.ok({
      id: "test-harness",
      createSession: unsupported,
      resumeSession: unsupported,
      listSessions: unsupported,
      getSession: unsupported,
      prompt: unsupported,
      deleteSession: unsupported,
      abort: unsupported,
      close: async () => {},
    });
  },
});

describe("structured file logging", () => {
  layer(nodeFsPathLayer)((it) => {
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

    it.effect("bridges orchestrator package logs through file logger", () =>
      withTempLogDir(({ logDir, paths }) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;

          yield* Effect.scoped(
            withFileLogger(
              { logDir, logLevel: "debug" },
              Effect.gen(function* () {
                const logger = yield* makeOrchestratorLogger();
                logger.info(
                  "xmux.orchestrator.test",
                  {
                    component: "@xmux/orchestrator",
                    requestId: "req-1",
                    token: "raw-token",
                  },
                  "do-not-log-optional",
                );
                logger.error("xmux.orchestrator.failure", {
                  component: "@xmux/orchestrator",
                  authorization: "Bearer raw-auth",
                });
              }),
            ),
          );

          const mainLog = yield* fs.readFileString(paths.mainLogPath);
          const errorLog = yield* fs.readFileString(paths.errorLogPath);
          assert.include(mainLog, "xmux.orchestrator.test");
          assert.include(errorLog, "xmux.orchestrator.failure");
          assert.notInclude(mainLog, "raw-token");
          assert.notInclude(mainLog, "raw-auth");
          assert.notInclude(mainLog, "do-not-log-optional");
          assert.notInclude(errorLog, "raw-auth");

          const entries = mainLog
            .split("\n")
            .filter((line) => line.trim().length > 0)
            .map(decodeJsonLine);
          const infoEntry = entries.find((entry) => entry.message === "xmux.orchestrator.test");
          if (infoEntry === undefined) assert.fail("Expected bridged info log entry");
          assert.strictEqual(infoEntry.annotations?.component, "@xmux/orchestrator");
          assert.strictEqual(infoEntry.annotations?.requestId, "req-1");
          assert.strictEqual(infoEntry.annotations?.token, "[redacted]");

          const errorEntries = errorLog
            .split("\n")
            .filter((line) => line.trim().length > 0)
            .map(decodeJsonLine);
          const errorEntry = errorEntries.find(
            (entry) => entry.message === "xmux.orchestrator.failure",
          );
          if (errorEntry === undefined) assert.fail("Expected bridged error log entry");
          assert.strictEqual(errorEntry.level, "error");
        }),
      ),
    );

    it.effect("writes real orchestrator runtime lifecycle logs through the bridge", () =>
      withTempLogDir(({ logDir, paths }) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;

          yield* Effect.scoped(
            withFileLogger(
              { logDir, logLevel: "debug" },
              Effect.gen(function* () {
                const logger = yield* makeOrchestratorLogger();
                const runtime = yield* createXmuxRuntime({
                  harnesses: { "test-harness": testHarnessAdapter },
                  chats: { "test-chat": testChatAdapter },
                  config: {
                    defaultWorkingDirectory: process.cwd(),
                    deliveryMode: "requester_only",
                  },
                  store: createInMemoryStore(),
                  logger,
                });

                const initialized = yield* Effect.promise(() => runtime.initialize());
                if (initialized.isErr()) assert.fail(initialized.error.message);

                const closed = yield* Effect.promise(() => runtime.shutdown());
                if (closed.isErr()) assert.fail(closed.error.message);
              }),
            ),
          );

          const mainLog = yield* fs.readFileString(paths.mainLogPath);
          assert.include(mainLog, "xmux.orchestrator.initialize.success");
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

    it.effect("applies minimum log level to bridged package logs", () =>
      Effect.gen(function* () {
        yield* withTempLogDir(({ logDir, paths }) =>
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;

            yield* Effect.scoped(
              withFileLogger(
                { logDir, logLevel: "info" },
                Effect.gen(function* () {
                  const logger = yield* makeOrchestratorLogger();
                  logger.debug("xmux.orchestrator.filtered-debug");
                  logger.info("xmux.orchestrator.kept-info");
                }),
              ),
            );

            const mainLog = yield* fs.readFileString(paths.mainLogPath);
            assert.notInclude(mainLog, "xmux.orchestrator.filtered-debug");
            assert.include(mainLog, "xmux.orchestrator.kept-info");
          }),
        );

        yield* withTempLogDir(({ logDir, paths }) =>
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;

            yield* Effect.scoped(
              withFileLogger(
                { logDir, logLevel: "debug" },
                Effect.gen(function* () {
                  const logger = yield* makeOrchestratorLogger();
                  logger.debug("xmux.orchestrator.kept-debug");
                }),
              ),
            );

            const mainLog = yield* fs.readFileString(paths.mainLogPath);
            assert.include(mainLog, "xmux.orchestrator.kept-debug");
          }),
        );
      }),
    );

    it.effect("rotates logs by size and tails across rotated files", () =>
      withTempLogDir(({ logDir, paths }) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;

          yield* Effect.scoped(
            withFileLogger(
              {
                logDir,
                maxBytes: logByteCountFromNumber(320),
                maxFiles: logRotationFileCountFromNumber(3),
              },
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

    it.effect("keeps the active file after tiny-limit rotation", () =>
      withTempLogDir(({ logDir, paths }) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;

          yield* Effect.scoped(
            withFileLogger(
              {
                logDir,
                maxBytes: logByteCountFromNumber(1),
                maxFiles: logRotationFileCountFromNumber(2),
              },
              Effect.gen(function* () {
                yield* Effect.logInfo("tiny-rotation-0");
                yield* Effect.logInfo("tiny-rotation-1");
              }),
            ),
          );

          assert.isTrue(yield* fs.exists(paths.mainLogPath));
          assert.isTrue(yield* fs.exists(rotatedLogPath(paths.mainLogPath, 1)));
          assert.isFalse(yield* fs.exists(rotatedLogPath(paths.mainLogPath, 2)));

          const activeLog = yield* fs.readFileString(paths.mainLogPath);
          const rotatedLog = yield* fs.readFileString(rotatedLogPath(paths.mainLogPath, 1));
          const entries = `${rotatedLog}${activeLog}`
            .split("\n")
            .filter((line) => line.trim().length > 0)
            .map(decodeJsonLine);

          assert.lengthOf(entries, 2);
          assert.strictEqual(entries[0]?.message, "tiny-rotation-0");
          assert.strictEqual(entries[1]?.message, "tiny-rotation-1");
        }),
      ),
    );

    it.effect("tails latest schema-valid entries from bounded log files", () =>
      withTempLogDir(({ paths, logDir }) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const lines = [
            LogEntry.make({
              timestamp: isoTimestampFromString("2026-06-16T00:00:00.000Z"),
              level: "info",
              message: "one",
            }),
            LogEntry.make({
              timestamp: isoTimestampFromString("2026-06-16T00:00:01.000Z"),
              level: "warn",
              message: "two",
            }),
            LogEntry.make({
              timestamp: isoTimestampFromString("2026-06-16T00:00:02.000Z"),
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
