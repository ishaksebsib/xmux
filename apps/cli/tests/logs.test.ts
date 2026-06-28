import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Layer, Option, Schema, Scope } from "effect";
import { TestConsole } from "effect/testing";
import { getLogsReport, runLogsCommand } from "../src/commands/logs";
import {
  ControlClient,
  type CliLogsResponse,
  type ControlClientService,
} from "../src/control/client";
import { ControlDiscovery, type ControlDiscoveryService } from "../src/control/discovery";
import { CliRunningServer } from "../src/domain/discovery";
import { nodeControlClientLayer } from "../src/platform/node/control-client";
import { nodeControlDiscoveryLayer } from "../src/platform/node/control-discovery";
import { CliInvalidInput } from "../src/domain/errors";
import { renderCliCause } from "../src/output/errors";
import { renderLogs, renderLogsJson } from "../src/output/logs";
import { cliRuntimeEnvForRoot, withEnvVars } from "./support/env";
import { runningServer } from "./support/client";
import { makeCliSandbox, writeText } from "./support/sandbox";
import {
  bindHealthServer,
  bindLogsServer,
  resolvePaths,
  writeServerManifest,
} from "./support/discovery";

const posixIt = process.platform === "win32" ? it.live.skip : it.live;

const logsLayer = Layer.mergeAll(nodeControlDiscoveryLayer, nodeControlClientLayer);

const withLogsSandbox = <A, E, R>(
  run: (input: { readonly root: string; readonly configPath: string }) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | Scope.Scope> =>
  Effect.gen(function* () {
    const sandbox = yield* makeCliSandbox;
    const configPath = join(sandbox.root, "config.jsonc");
    return yield* withEnvVars(
      cliRuntimeEnvForRoot(sandbox.root),
      run({ root: sandbox.root, configPath }),
    );
  });

const reportForConfig = (
  configPath: string,
  tail: Option.Option<number> = Option.none(),
  json = false,
) =>
  getLogsReport({ configPath: Option.some(configPath), tail, json }).pipe(
    Effect.provide(logsLayer),
  );

const LogsJsonContract = Schema.TaggedStruct("Logs", {
  kind: Schema.Literal("logs"),
  version: Schema.Number,
  server: Schema.Struct({
    scopeId: Schema.String,
    configPath: Schema.String,
    socketPath: Schema.String,
    manifestPath: Schema.String,
    pid: Schema.Number,
    pidAlive: Schema.Boolean,
    sessionId: Schema.String,
  }),
  entries: Schema.Array(
    Schema.Struct({
      timestamp: Schema.String,
      level: Schema.String,
      message: Schema.String,
      annotations: Schema.optionalKey(Schema.Unknown),
      spans: Schema.optionalKey(Schema.Unknown),
      cause: Schema.optionalKey(Schema.Unknown),
    }),
  ),
});

const decodeLogsJsonOutput = Schema.decodeUnknownSync(LogsJsonContract);

const expectValidJson = (output: string): void => {
  expect(() => decodeLogsJsonOutput(JSON.parse(output))).not.toThrow();
};

describe.sequential("logs command", () => {
  posixIt("fails stopped/no manifest scope as not running", () =>
    withLogsSandbox(({ configPath }) =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(reportForConfig(configPath));

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const failure = Cause.squash(exit.cause);
          expect(failure).toHaveProperty("_tag", "CliServerNotRunning");
          expect(failure).toHaveProperty("reason", "no-manifest");
        }
      }),
    ),
  );

  posixIt("keeps invalid manifests as explicit typed failures", () =>
    withLogsSandbox(({ configPath }) =>
      Effect.gen(function* () {
        const paths = yield* resolvePaths(configPath);
        yield* writeText(paths.manifestPath, "not json");

        const exit = yield* Effect.exit(reportForConfig(configPath));

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const failure = Cause.squash(exit.cause);
          expect(failure).toHaveProperty("_tag", "CliServerNotRunning");
          expect(failure).toHaveProperty("reason", "invalid-manifest");
        }
      }),
    ),
  );

  posixIt("keeps wrong-scope manifests as explicit typed failures", () =>
    withLogsSandbox(({ configPath }) =>
      Effect.gen(function* () {
        const paths = yield* resolvePaths(configPath);
        yield* writeServerManifest(paths, { scopeId: "wrong-scope" });

        const exit = yield* Effect.exit(reportForConfig(configPath));

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const failure = Cause.squash(exit.cause);
          expect(failure).toHaveProperty("_tag", "CliServerNotRunning");
          expect(failure).toHaveProperty("reason", "wrong-scope");
        }
      }),
    ),
  );

  posixIt("keeps stale manifests as explicit typed failures", () =>
    withLogsSandbox(({ configPath }) =>
      Effect.gen(function* () {
        const paths = yield* resolvePaths(configPath);
        yield* writeServerManifest(paths, { sessionId: "stale-logs" });

        const exit = yield* Effect.exit(reportForConfig(configPath));

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const failure = Cause.squash(exit.cause);
          expect(failure).toHaveProperty("_tag", "CliServerNotRunning");
          expect(failure).toHaveProperty("reason", "stale-manifest-removed");
        }
      }),
    ),
  );

  posixIt("calls the control logs API with parsed tail and renders entries", () =>
    withLogsSandbox(({ configPath }) =>
      Effect.gen(function* () {
        const paths = yield* resolvePaths(configPath);
        let requestedUrl = "";
        yield* bindLogsServer(
          paths,
          [
            {
              timestamp: "2026-06-16T00:00:00.000Z",
              level: "info",
              message: "server ready",
              annotations: { component: "server" },
            },
          ],
          (url) => {
            requestedUrl = url;
          },
        );
        yield* writeServerManifest(paths, { sessionId: "active-logs" });

        const report = yield* reportForConfig(configPath, Option.some(1));
        const human = renderLogs(report, "human");
        const json = renderLogs(report, "json");

        expect(requestedUrl).toBe("/v1/logs?tail=1");
        expect(human).toContain("xmux logs: 1 entry");
        expect(human).toContain("2026-06-16T00:00:00.000Z info server ready");
        expect(human).toContain('annotations={"component":"server"}');
        expect(json).toContain('"kind": "logs"');
        expect(json).toContain('"message": "server ready"');
        expectValidJson(json);
      }),
    ),
  );

  posixIt("renders empty logs clearly and as valid JSON", () =>
    withLogsSandbox(({ configPath }) =>
      Effect.gen(function* () {
        const paths = yield* resolvePaths(configPath);
        yield* bindLogsServer(paths, []);
        yield* writeServerManifest(paths, { sessionId: "empty-logs" });

        const report = yield* reportForConfig(configPath, Option.none(), true);
        const human = renderLogs(report, "human");
        const json = renderLogsJson(report);

        expect(human).toContain("xmux logs: empty");
        expect(json.trimStart().startsWith("{")).toBe(true);
        expect(json).not.toContain("xmux logs");
        expect(json).toContain('"entries": []');
        expectValidJson(json);
      }),
    ),
  );

  posixIt("classifies failing logs API responses through ControlClient errors", () =>
    withLogsSandbox(({ configPath }) =>
      Effect.gen(function* () {
        const paths = yield* resolvePaths(configPath);
        yield* bindHealthServer(paths.socketPath);
        yield* writeServerManifest(paths, { sessionId: "missing-logs-route" });

        const exit = yield* Effect.exit(reportForConfig(configPath));

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const failure = Cause.squash(exit.cause);
          expect(failure).toHaveProperty("_tag", "CliControlRequestError");
        }
      }),
    ),
  );

  it.live("classifies request-time logs socket failures as unreachable", () =>
    Effect.gen(function* () {
      const missingSocket = join(tmpdir(), `xmux-missing-logs-${process.pid}-${Date.now()}.sock`);
      const server = new CliRunningServer({
        _tag: "Running",
        paths: yield* resolvePaths(join(tmpdir(), `xmux-config-${Date.now()}.jsonc`)),
        manifestPath: join(tmpdir(), "xmux-missing-manifest.json"),
        socketPath: missingSocket,
        pid: process.pid,
        pidAlive: true,
        sessionId: "unreachable-logs",
      });
      const discovery: ControlDiscoveryService = {
        resolvePaths: () => Effect.succeed(server.paths),
        readManifest: () => Effect.die("readManifest should not be called"),
        discover: () => Effect.succeed(server),
        requireRunning: () => Effect.succeed(server),
      };
      const layer = Layer.mergeAll(
        Layer.succeed(ControlDiscovery, discovery),
        nodeControlClientLayer,
      );

      const exit = yield* Effect.exit(
        getLogsReport({
          configPath: Option.some(server.paths.configPath),
          tail: Option.none(),
          json: false,
        }).pipe(Effect.provide(layer)),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.squash(exit.cause);
        expect(failure).toHaveProperty("_tag", "CliServerUnreachable");
        expect(failure).toHaveProperty("operation", "logs");
      }
    }),
  );

  it.effect("runLogsCommand writes rendered output to Console.log", () =>
    Effect.gen(function* () {
      const server = runningServer("/tmp/xmux-test-logs-command.sock");
      const discovery: ControlDiscoveryService = {
        resolvePaths: () => Effect.succeed(server.paths),
        readManifest: () => Effect.die("readManifest should not be called"),
        discover: () => Effect.succeed(server),
        requireRunning: () => Effect.succeed(server),
      };
      const response: CliLogsResponse = {
        version: 1,
        entries: [],
      };
      const client: ControlClientService = {
        health: () => Effect.die("health should not be called"),
        status: () => Effect.die("status should not be called"),
        logs: () => Effect.succeed(response),
        shutdown: () => Effect.die("shutdown should not be called"),
      };
      const layer = Layer.mergeAll(
        Layer.succeed(ControlDiscovery, discovery),
        Layer.succeed(ControlClient, client),
      );

      yield* runLogsCommand({
        configPath: Option.some(server.paths.configPath),
        tail: Option.none(),
        json: true,
      }).pipe(Effect.provide(layer));

      const stdout = yield* TestConsole.logLines;
      expect(stdout).toHaveLength(1);
      const output = String(stdout[0]);
      expect(output).toContain('"kind": "logs"');
      expect(output).toContain('"entries": []');
      expectValidJson(output);
    }),
  );

  it.effect("fails invalid --tail before discovery or client calls", () =>
    Effect.gen(function* () {
      let discoveryCalled = false;
      let clientCalled = false;
      const discoveryFailure = Effect.sync(() => {
        discoveryCalled = true;
      }).pipe(Effect.flatMap(() => Effect.die("discovery should not be called")));
      const clientFailure = Effect.sync(() => {
        clientCalled = true;
      }).pipe(Effect.flatMap(() => Effect.die("client should not be called")));
      const discovery: ControlDiscoveryService = {
        resolvePaths: () => discoveryFailure,
        readManifest: () => discoveryFailure,
        discover: () => discoveryFailure,
        requireRunning: () => discoveryFailure,
      };
      const client: ControlClientService = {
        health: () => clientFailure,
        status: () => clientFailure,
        logs: () => clientFailure,
        shutdown: () => clientFailure,
      };
      const layer = Layer.mergeAll(
        Layer.succeed(ControlDiscovery, discovery),
        Layer.succeed(ControlClient, client),
      );

      const exit = yield* Effect.exit(
        getLogsReport({
          configPath: Option.some("/tmp/xmux-config.jsonc"),
          tail: Option.some(0),
          json: false,
        }).pipe(Effect.provide(layer)),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.squash(exit.cause);
        expect(failure).toBeInstanceOf(CliInvalidInput);
        expect(renderCliCause(exit.cause, false)).toBe(
          "Invalid --tail value. Expected a positive integer.",
        );
      }
      expect(discoveryCalled).toBe(false);
      expect(clientCalled).toBe(false);
    }),
  );

  it.effect("fails invalid --config before discovery or client calls", () =>
    Effect.gen(function* () {
      let discoveryCalled = false;
      let clientCalled = false;
      const discoveryFailure = Effect.sync(() => {
        discoveryCalled = true;
      }).pipe(Effect.flatMap(() => Effect.die("discovery should not be called")));
      const clientFailure = Effect.sync(() => {
        clientCalled = true;
      }).pipe(Effect.flatMap(() => Effect.die("client should not be called")));
      const discovery: ControlDiscoveryService = {
        resolvePaths: () => discoveryFailure,
        readManifest: () => discoveryFailure,
        discover: () => discoveryFailure,
        requireRunning: () => discoveryFailure,
      };
      const client: ControlClientService = {
        health: () => clientFailure,
        status: () => clientFailure,
        logs: () => clientFailure,
        shutdown: () => clientFailure,
      };
      const layer = Layer.mergeAll(
        Layer.succeed(ControlDiscovery, discovery),
        Layer.succeed(ControlClient, client),
      );

      const exit = yield* Effect.exit(
        getLogsReport({ configPath: Option.some(""), tail: Option.some(1), json: false }).pipe(
          Effect.provide(layer),
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.squash(exit.cause);
        expect(failure).toBeInstanceOf(CliInvalidInput);
        expect(renderCliCause(exit.cause, false)).toBe("Invalid --config path.");
      }
      expect(discoveryCalled).toBe(false);
      expect(clientCalled).toBe(false);
    }),
  );
});
