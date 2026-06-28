import { spawn } from "node:child_process";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Scope } from "effect";
import {
  formatCliRunResult,
  isExited,
  makeInstalledCliHarness,
  terminateProcess,
  waitForCondition,
  waitForExit,
  type CliRunResult,
} from "../support/cli-subprocess";
import { cliRuntimeEnvForRoot, withEnvVars } from "../support/env";
import { minimalConfig, writeText } from "../support/sandbox";
import { resolvePaths } from "../support/discovery";

const describeIntegration =
  process.env.RUN_INTEGRATION === "true" ? describe.sequential : describe.skip;
const posixIt = process.platform === "win32" ? it.live.skip : it.live;

const TEST_SECRET = "xmux_phase9_secret_should_not_leak";

const objectField = (value: unknown, key: string): unknown => {
  if (typeof value !== "object" || value === null) return undefined;
  return Object.entries(value).find(([entryKey]) => entryKey === key)?.[1];
};

const parseJsonObject = (text: string): Record<string, unknown> => {
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("expected a JSON object");
  }
  return Object.fromEntries(Object.entries(value));
};

const expectSuccess = (result: CliRunResult): void => {
  expect(result.timedOut, formatCliRunResult(result)).toBe(false);
  expect(result.exitCode, formatCliRunResult(result)).toBe(0);
};

const expectFailure = (result: CliRunResult): void => {
  expect(result.timedOut, formatCliRunResult(result)).toBe(false);
  expect(result.exitCode, formatCliRunResult(result)).not.toBe(0);
};

const expectJsonOnly = (result: CliRunResult): Record<string, unknown> => {
  expectSuccess(result);
  expect(result.stderr, formatCliRunResult(result)).toBe("");
  const trimmed = result.stdout.trim();
  expect(trimmed.startsWith("{"), formatCliRunResult(result)).toBe(true);
  expect(trimmed.endsWith("}"), formatCliRunResult(result)).toBe(true);
  return parseJsonObject(trimmed);
};

const objectRecordField = (value: unknown, key: string): Record<string, unknown> => {
  const field = objectField(value, key);
  if (typeof field !== "object" || field === null || Array.isArray(field)) {
    throw new Error(`missing object field ${key}: ${JSON.stringify(value)}`);
  }
  return Object.fromEntries(Object.entries(field));
};

const stringField = (value: unknown, key: string): string => {
  const field = objectField(value, key);
  if (typeof field !== "string" || field.length === 0) {
    throw new Error(`missing string field ${key}: ${JSON.stringify(value)}`);
  }
  return field;
};

const sessionIdFromStatus = (status: Record<string, unknown>): string => {
  const discovery = objectField(status, "discovery");
  const sessionId = objectField(discovery, "sessionId");
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new Error(`missing status discovery.sessionId: ${JSON.stringify(status)}`);
  }
  return sessionId;
};

const addStopFinalizer = (
  runCli: (args: ReadonlyArray<string>) => Effect.Effect<CliRunResult, never, Scope.Scope>,
  configPath: string,
) =>
  Effect.addFinalizer(() =>
    Effect.scoped(runCli(["stop", "--config", configPath])).pipe(Effect.ignore),
  );

describeIntegration("installed xmux executable lifecycle", () => {
  posixIt("prints help and version through an extensionless installed bin symlink", () =>
    Effect.gen(function* () {
      const harness = yield* makeInstalledCliHarness;

      const help = yield* harness.runCli(["--help"]);
      expectSuccess(help);
      expect(help.stdout).toContain("xmux");
      expect(help.stdout).toContain("start");
      expect(help.stdout).toContain("server");

      const version = yield* harness.runCli(["--version"]);
      expectSuccess(version);
      expect(version.stdout.trim()).toBe("xmux v0.0.0");
    }),
  );

  posixIt("renders stopped status as JSON only", () =>
    Effect.gen(function* () {
      const harness = yield* makeInstalledCliHarness;
      yield* harness.sandbox.writeConfig(minimalConfig());

      const status = expectJsonOnly(
        yield* harness.runCli(["status", "--json", "--config", harness.sandbox.configPath]),
      );
      expect(objectField(status, "status")).toBe("stopped");
      expect(objectField(status, "reason")).toBe("no-manifest");
    }),
  );

  posixIt("foreground server cleans manifest and socket after SIGTERM", () =>
    Effect.gen(function* () {
      const harness = yield* makeInstalledCliHarness;
      yield* harness.sandbox.writeConfig(minimalConfig());
      const paths = yield* withEnvVars(
        cliRuntimeEnvForRoot(harness.sandbox.root),
        resolvePaths(harness.sandbox.configPath),
      );
      const subprocess = yield* harness.spawnCli([
        "server",
        "run",
        "--foreground",
        "--config",
        harness.sandbox.configPath,
      ]);

      const started = yield* waitForCondition({
        check: harness.sandbox
          .exists(paths.manifestPath)
          .pipe(Effect.map((manifestExists) => manifestExists && !isExited(subprocess.child))),
        timeoutMs: 15_000,
      });
      expect(started, yield* subprocess.output).toBe(true);

      subprocess.child.kill("SIGTERM");
      yield* waitForExit(subprocess.child);

      const cleaned = yield* waitForCondition({
        check: Effect.gen(function* () {
          const manifestExists = yield* harness.sandbox.exists(paths.manifestPath);
          const socketExists = yield* harness.sandbox.exists(paths.socketPath);
          return !manifestExists && !socketExists;
        }),
        timeoutMs: 3_000,
      });
      expect(cleaned, yield* subprocess.output).toBe(true);
    }),
  );

  posixIt("start, status, logs, stop, and second stop work through the installed bin", () =>
    Effect.gen(function* () {
      const harness = yield* makeInstalledCliHarness;
      yield* harness.sandbox.writeConfig(minimalConfig());
      yield* addStopFinalizer(harness.runCli, harness.sandbox.configPath);
      const paths = yield* withEnvVars(
        cliRuntimeEnvForRoot(harness.sandbox.root),
        resolvePaths(harness.sandbox.configPath),
      );

      const start = yield* harness.runCli(["start", "--config", harness.sandbox.configPath]);
      expectSuccess(start);
      expect(start.stdout).toContain("xmux server: started");

      const status = expectJsonOnly(
        yield* harness.runCli(["status", "--json", "--config", harness.sandbox.configPath]),
      );
      expect(objectField(status, "status")).toBe("running");

      const logs = expectJsonOnly(
        yield* harness.runCli([
          "logs",
          "--json",
          "--tail",
          "20",
          "--config",
          harness.sandbox.configPath,
        ]),
      );
      expect(objectField(logs, "kind")).toBe("logs");
      expect(JSON.stringify(logs)).not.toContain(TEST_SECRET);

      const stop = yield* harness.runCli(["stop", "--config", harness.sandbox.configPath]);
      expectSuccess(stop);
      expect(stop.stdout).toContain("xmux server: stopped");

      const cleaned = yield* waitForCondition({
        check: Effect.gen(function* () {
          const manifestExists = yield* harness.sandbox.exists(paths.manifestPath);
          const socketExists = yield* harness.sandbox.exists(paths.socketPath);
          return !manifestExists && !socketExists;
        }),
        timeoutMs: 3_000,
      });
      expect(cleaned, formatCliRunResult(stop)).toBe(true);

      const secondStop = yield* harness.runCli(["stop", "--config", harness.sandbox.configPath]);
      expectSuccess(secondStop);
      expect(secondStop.stdout).toContain("xmux server: already stopped");
    }),
  );

  posixIt("restart replaces a running session and starts from stopped state", () =>
    Effect.gen(function* () {
      const runningHarness = yield* makeInstalledCliHarness;
      yield* runningHarness.sandbox.writeConfig(minimalConfig());
      yield* addStopFinalizer(runningHarness.runCli, runningHarness.sandbox.configPath);

      expectSuccess(
        yield* runningHarness.runCli(["start", "--config", runningHarness.sandbox.configPath]),
      );
      const before = expectJsonOnly(
        yield* runningHarness.runCli([
          "status",
          "--json",
          "--config",
          runningHarness.sandbox.configPath,
        ]),
      );
      const firstSession = sessionIdFromStatus(before);

      const restart = yield* runningHarness.runCli([
        "restart",
        "--config",
        runningHarness.sandbox.configPath,
      ]);
      expectSuccess(restart);
      expect(restart.stdout).toContain("xmux server: restarted");

      const after = expectJsonOnly(
        yield* runningHarness.runCli([
          "status",
          "--json",
          "--config",
          runningHarness.sandbox.configPath,
        ]),
      );
      expect(objectField(after, "status")).toBe("running");
      expect(sessionIdFromStatus(after)).not.toBe(firstSession);

      const stoppedHarness = yield* makeInstalledCliHarness;
      yield* stoppedHarness.sandbox.writeConfig(minimalConfig());
      yield* addStopFinalizer(stoppedHarness.runCli, stoppedHarness.sandbox.configPath);
      const restartStopped = yield* stoppedHarness.runCli([
        "restart",
        "--config",
        stoppedHarness.sandbox.configPath,
      ]);
      expectSuccess(restartStopped);
      expect(restartStopped.stdout).toContain("xmux server: started");
      const stoppedStatus = expectJsonOnly(
        yield* stoppedHarness.runCli([
          "status",
          "--json",
          "--config",
          stoppedHarness.sandbox.configPath,
        ]),
      );
      expect(objectField(stoppedStatus, "status")).toBe("running");
    }),
  );

  posixIt("stale manifests are cleaned without signaling the manifest PID", () =>
    Effect.gen(function* () {
      const harness = yield* makeInstalledCliHarness;
      yield* harness.sandbox.writeConfig(minimalConfig());
      const stoppedStatus = expectJsonOnly(
        yield* harness.runCli(["status", "--json", "--config", harness.sandbox.configPath]),
      );
      const paths = objectRecordField(stoppedStatus, "paths");
      const manifestPath = stringField(paths, "manifestPath");
      const socketPath = stringField(paths, "socketPath");
      const stateDir = stringField(paths, "stateDir");
      const scopeId = stringField(paths, "scopeId");
      const configPath = stringField(paths, "configPath");
      const sentinel = yield* Effect.acquireRelease(
        Effect.sync(() =>
          spawn(process.execPath, ["-e", "setInterval(() => undefined, 1000)"], {
            stdio: "ignore",
          }),
        ),
        terminateProcess,
      );
      yield* writeText(
        manifestPath,
        JSON.stringify({
          version: 1,
          protocolVersion: 1,
          pid: sentinel.pid ?? process.pid,
          sessionId: "stale-manifest-e2e",
          startedAt: "2026-06-16T00:00:00.000Z",
          configPath,
          stateDir,
          scopeId,
          endpoint: { kind: "unix-socket", path: socketPath },
          owner: {
            client: "test",
            version: "0.0.0",
            executablePath: process.execPath,
          },
        }),
      );
      expect(yield* harness.sandbox.exists(manifestPath), manifestPath).toBe(true);

      const status = expectJsonOnly(
        yield* harness.runCli(["status", "--json", "--config", harness.sandbox.configPath]),
      );
      expect(
        objectField(status, "status"),
        `expected stale cleanup for manifest ${manifestPath}; status=${JSON.stringify(status)}`,
      ).toBe("stale-manifest-cleaned");
      expect(isExited(sentinel)).toBe(false);
      expect(yield* harness.sandbox.exists(manifestPath)).toBe(false);
    }),
  );

  posixIt("invalid config fails foreground and detached start safely", () =>
    Effect.gen(function* () {
      const harness = yield* makeInstalledCliHarness;
      const invalidConfig = `{ "xmux": { "workspace": { "defaultDir": "" } }, "note": "${TEST_SECRET}" }\n`;
      yield* writeText(harness.sandbox.configPath, invalidConfig);

      const foreground = yield* harness.runCli([
        "server",
        "run",
        "--foreground",
        "--config",
        harness.sandbox.configPath,
      ]);
      expectFailure(foreground);
      expect(`${foreground.stdout}${foreground.stderr}`).toContain("Expected a value");
      expect(`${foreground.stdout}${foreground.stderr}`).not.toContain(TEST_SECRET);
      expect(`${foreground.stdout}${foreground.stderr}`).not.toContain(invalidConfig.trim());

      const start = yield* harness.runCli(["start", "--config", harness.sandbox.configPath]);
      expectFailure(start);
      expect(`${start.stdout}${start.stderr}`).toContain("exited before it became ready");
      expect(`${start.stdout}${start.stderr}`).toContain("xmux server run --foreground");
      expect(`${start.stdout}${start.stderr}`).not.toContain(TEST_SECRET);
      expect(`${start.stdout}${start.stderr}`).not.toContain(invalidConfig.trim());
    }),
  );
});
