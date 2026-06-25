import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { LogEntry } from "../../src/contracts/logging";
import { SERVER_ERROR_LOG_FILE_NAME, SERVER_LOG_FILE_NAME } from "../../src/logging/file-logger";
import { tailLogs } from "../support/client";
import { sttInlineSecretConfig } from "../support/config";
import { withSubprocessServer } from "../support/subprocess-server";
import { waitUntil } from "../support/wait";

const posixOnly = process.platform === "win32" ? it.live.skip : it.live;
const describeIntegration = process.env.RUN_INTEGRATION === "true" ? describe : describe.skip;
const decodeUnknownJsonOption = Schema.decodeUnknownOption(Schema.UnknownFromJsonString);
const decodeLogEntry = Schema.decodeUnknownOption(LogEntry);

const decodeJsonLines = (text: string): ReadonlyArray<LogEntry> =>
  text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const json = decodeUnknownJsonOption(line);
      if (json._tag === "None") assert.fail(`Expected JSON log line: ${line}`);
      const entry = decodeLogEntry(json.value);
      if (entry._tag === "None") assert.fail(`Expected schema-valid log entry: ${line}`);
      return entry.value;
    });

const isServerStartedMessage = (message: LogEntry["message"]): boolean =>
  Array.isArray(message) ? message.includes("server started") : message === "server started";

const rotatingLogConfig = (token: string): string => `{
  "xmux": { "workspace": { "defaultDir": "./workspace" } },
  "server": {
    "logs": {
      "level": "info",
      "rotation": { "maxBytes": 1, "maxFiles": 2 }
    }
  },
  "stt": {
    "apiKey": { "value": "${token}" },
    "model": "gpt-4o-mini-transcribe"
  }
}`;

describeIntegration("server file logging integration", () => {
  posixOnly(
    "writes real schema-valid redacted JSONL files and exposes the same log stream via API",
    () =>
      withSubprocessServer(
        { config: sttInlineSecretConfig("inline-telegram-token-do-not-leak") },
        ({ paths, socketPath, shutdown }) =>
          Effect.gen(function* () {
            const mainLogPath = join(paths.logDir, SERVER_LOG_FILE_NAME);
            const errorLogPath = join(paths.logDir, SERVER_ERROR_LOG_FILE_NAME);

            const mainStat = yield* waitUntil({
              label: "non-empty server log file",
              probe: Effect.promise(() => stat(mainLogPath)).pipe(
                Effect.map((fileStat) => (fileStat.size > 0 ? fileStat : undefined)),
              ),
            });
            const errorStat = yield* Effect.promise(() => stat(errorLogPath));
            assert.strictEqual(mainStat.mode & 0o777, 0o600);
            assert.strictEqual(errorStat.mode & 0o777, 0o600);

            const mainLog = yield* Effect.promise(() => readFile(mainLogPath, "utf8"));
            const errorLog = yield* Effect.promise(() => readFile(errorLogPath, "utf8"));
            assert.notInclude(mainLog, "inline-telegram-token-do-not-leak");
            assert.notInclude(errorLog, "inline-telegram-token-do-not-leak");

            const diskEntries = decodeJsonLines(mainLog);
            assert.isAtLeast(diskEntries.length, 1);
            assert.isTrue(diskEntries.some((entry) => entry.level === "info"));
            assert.isTrue(diskEntries.some((entry) => isServerStartedMessage(entry.message)));

            const apiLogs = yield* tailLogs(socketPath, 20);
            assert.isAtLeast(apiLogs.entries.length, 1);
            assert.notInclude(JSON.stringify(apiLogs), "inline-telegram-token-do-not-leak");
            assert.isTrue(apiLogs.entries.some((entry) => isServerStartedMessage(entry.message)));

            yield* shutdown;
          }),
      ),
    15_000,
  );

  posixOnly(
    "rotates real log files and enforces the configured file limit",
    () =>
      withSubprocessServer(
        { config: rotatingLogConfig("rotation-token-do-not-leak") },
        ({ paths, shutdown }) =>
          Effect.gen(function* () {
            yield* waitUntil({
              label: "rotated server log file",
              probe: Effect.promise(() => readdir(paths.logDir)).pipe(
                Effect.map((files) =>
                  files.includes(`${SERVER_LOG_FILE_NAME}.1`) ? files : undefined,
                ),
              ),
            });

            yield* shutdown;

            const files = yield* Effect.promise(() => readdir(paths.logDir));
            const mainFiles = files.filter((file) => file.startsWith(SERVER_LOG_FILE_NAME)).sort();
            const errorFiles = files
              .filter((file) => file.startsWith(SERVER_ERROR_LOG_FILE_NAME))
              .sort();

            assert.deepStrictEqual(mainFiles, [SERVER_LOG_FILE_NAME, `${SERVER_LOG_FILE_NAME}.1`]);
            assert.deepStrictEqual(errorFiles, [SERVER_ERROR_LOG_FILE_NAME]);
            assert.notInclude(mainFiles.join("\n"), `${SERVER_LOG_FILE_NAME}.2`);
            assert.notInclude(errorFiles.join("\n"), `${SERVER_ERROR_LOG_FILE_NAME}.1`);

            const activeLog = yield* Effect.promise(() =>
              readFile(join(paths.logDir, SERVER_LOG_FILE_NAME), "utf8"),
            );
            const rotatedLog = yield* Effect.promise(() =>
              readFile(join(paths.logDir, `${SERVER_LOG_FILE_NAME}.1`), "utf8"),
            );
            const entries = decodeJsonLines(`${rotatedLog}${activeLog}`);

            assert.lengthOf(entries, 2);
            assert.isTrue(entries.every((entry) => entry.level === "info"));
            assert.isTrue(entries.every((entry) => typeof entry.timestamp === "string"));
            assert.notInclude(`${activeLog}${rotatedLog}`, "rotation-token-do-not-leak");
          }),
      ),
    15_000,
  );
});
