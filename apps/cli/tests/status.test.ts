import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Layer, Option, Schema, Scope } from "effect";
import { getStatusReport } from "../src/commands/status";
import { ConfigSummary, type ConfigSummaryService } from "../src/control/config-summary";
import { ControlClient, type ControlClientService } from "../src/control/client";
import { ControlDiscovery, type ControlDiscoveryService } from "../src/control/discovery";
import { nodeConfigSummaryLayer } from "../src/platform/node/config-summary";
import { nodeControlClientLayer } from "../src/platform/node/control-client";
import { nodeControlDiscoveryLayer } from "../src/platform/node/control-discovery";
import { CliInvalidInput } from "../src/domain/errors";
import { CliOrchestratorStatus } from "../src/domain/status";
import { renderCliCause } from "../src/output/errors";
import { renderStatus, renderStatusJson } from "../src/output/status";
import { cliRuntimeEnvForRoot, withEnvVars } from "./support/env";
import { makeCliSandbox, writeText } from "./support/sandbox";
import {
  bindHealthServer,
  bindLegacyStatusServer,
  bindStatusServer,
  resolvePaths,
  writeServerManifest,
} from "./support/discovery";

const posixIt = process.platform === "win32" ? it.live.skip : it.live;

const statusLayer = Layer.mergeAll(
  nodeControlDiscoveryLayer,
  nodeControlClientLayer,
  nodeConfigSummaryLayer,
);

const validStatusConfig = `{
  "chats": {
    "telegram": {
      "enabled": true,
      "token": { "value": "secret-token-should-not-leak" },
      "access": { "type": "anyone" }
    }
  },
  "harnesses": { "pi": { "enabled": true } }
}`;

const invalidStatusConfig = `{ "server": { "logs": { "level": "verbose" } } }`;

const envSecretStatusConfig = `{
  "chats": {
    "telegram": {
      "enabled": true,
      "token": { "env": "XMUX_TEST_MISSING_TOKEN" },
      "access": { "type": "anyone" }
    }
  },
  "harnesses": { "pi": { "enabled": true } }
}`;

const withStatusSandbox = <A, E, R>(
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

const reportForConfig = (configPath: string, json = false) =>
  getStatusReport({ configPath: Option.some(configPath), json }).pipe(Effect.provide(statusLayer));

const StatusJsonContract = Schema.Struct({
  status: Schema.String,
  _tag: Schema.String,
  paths: Schema.Struct({
    configPath: Schema.String,
    stateDir: Schema.String,
    runtimeDir: Schema.String,
    logDir: Schema.String,
    manifestPath: Schema.String,
    startupLockPath: Schema.String,
    socketPath: Schema.String,
    scopeId: Schema.String,
  }),
  reason: Schema.optionalKey(Schema.String),
  discovery: Schema.optionalKey(Schema.Unknown),
  server: Schema.optionalKey(Schema.Unknown),
});

const decodeStatusJsonOutput = Schema.decodeUnknownSync(StatusJsonContract);
const decodeCliOrchestratorStatus = Schema.decodeUnknownSync(CliOrchestratorStatus);

const expectValidJson = (output: string): void => {
  expect(() => decodeStatusJsonOutput(JSON.parse(output))).not.toThrow();
};

describe.sequential("status command", () => {
  it("rejects unsafe raw failure reasons in the CLI status domain", () => {
    expect(() =>
      decodeCliOrchestratorStatus({
        state: "failed",
        activation: "enabled",
        chats: [
          {
            id: "telegram",
            state: "failed",
            reason: "request failed with token secret-token-should-not-leak",
          },
        ],
        harnesses: [{ id: "pi", state: "configured_lazy" }],
      }),
    ).toThrow();
  });

  posixIt("renders stopped/no manifest status successfully", () =>
    withStatusSandbox(({ configPath }) =>
      Effect.gen(function* () {
        yield* writeText(configPath, validStatusConfig);
        const report = yield* reportForConfig(configPath);
        const human = renderStatus(report, "human");
        const json = renderStatusJson(report);

        expect(report._tag).toBe("Stopped");
        expect(human).toContain("xmux server: stopped");
        expect(human).toContain("reason: no-manifest");
        expect(human).not.toContain(configPath);
        expect(human).toContain("orchestrator: unavailable (server not running)");
        expect(human).toContain("telegram: configured, runtime unavailable");
        expect(human).toContain("pi: configured_lazy, runtime unavailable");
        expect(human).not.toContain("secret-token-should-not-leak");
        expect(json).toContain('"status": "stopped"');
        expect(json).toContain('"runtime": "unavailable"');
        expect(json).not.toContain("secret-token-should-not-leak");
        expectValidJson(json);
      }),
    ),
  );

  posixIt("renders stopped/no manifest status with invalid config summary", () =>
    withStatusSandbox(({ configPath }) =>
      Effect.gen(function* () {
        yield* writeText(configPath, invalidStatusConfig);
        const report = yield* reportForConfig(configPath);
        const human = renderStatus(report, "human");

        expect(report._tag).toBe("Stopped");
        expect(human).toContain("config status: invalid");
        expect(human).not.toContain("secret-token-should-not-leak");
      }),
    ),
  );

  posixIt("treats missing inactive config as valid empty defaults", () =>
    withStatusSandbox(({ configPath }) =>
      Effect.gen(function* () {
        const report = yield* reportForConfig(configPath);
        const human = renderStatus(report, "human");

        expect(report._tag).toBe("Stopped");
        expect(human).toContain("config status: valid");
        expect(human).toContain("chats:\n  (none)");
        expect(human).toContain("harnesses:\n  (none)");
      }),
    ),
  );

  posixIt("reports configured adapters even when inactive env secrets are missing", () =>
    withStatusSandbox(({ configPath }) =>
      Effect.gen(function* () {
        yield* writeText(configPath, envSecretStatusConfig);
        const report = yield* reportForConfig(configPath);
        const human = renderStatus(report, "human");

        expect(report._tag).toBe("Stopped");
        expect(human).toContain("config status: valid");
        expect(human).toContain("telegram: configured, runtime unavailable");
        expect(human).toContain("pi: configured_lazy, runtime unavailable");
        expect(human).not.toContain("XMUX_TEST_MISSING_TOKEN");
      }),
    ),
  );

  posixIt("renders invalid manifests without crashing", () =>
    withStatusSandbox(({ configPath }) =>
      Effect.gen(function* () {
        const paths = yield* resolvePaths(configPath);
        yield* writeText(paths.manifestPath, "not json");

        const report = yield* reportForConfig(configPath);
        const human = renderStatus(report, "human");
        const json = renderStatusJson(report);

        expect(report._tag).toBe("InvalidManifest");
        expect(human).toContain("xmux server: invalid-manifest");
        expect(json).toContain('"status": "invalid-manifest"');
        expectValidJson(json);
      }),
    ),
  );

  posixIt("reflects stale manifest cleanup safely", () =>
    withStatusSandbox(({ configPath }) =>
      Effect.gen(function* () {
        const paths = yield* resolvePaths(configPath);
        yield* writeServerManifest(paths, { sessionId: "stale-status" });

        const report = yield* reportForConfig(configPath);
        const human = renderStatus(report, "human");

        expect(report._tag).toBe("StaleManifestCleaned");
        expect(human).toContain("xmux server: stale-manifest-cleaned");
        expect(human).toContain("reason: stale-manifest-removed");
      }),
    ),
  );

  posixIt("renders wrong-scope manifests explicitly", () =>
    withStatusSandbox(({ configPath }) =>
      Effect.gen(function* () {
        const paths = yield* resolvePaths(configPath);
        yield* writeServerManifest(paths, { scopeId: "wrong-scope" });

        const report = yield* reportForConfig(configPath);
        const human = renderStatus(report, "human");

        expect(report._tag).toBe("WrongScope");
        expect(human).toContain("xmux server: wrong-scope");
        expect(human).toContain("reason: wrong-scope");
      }),
    ),
  );

  posixIt("calls the control API and renders running status", () =>
    withStatusSandbox(({ configPath }) =>
      Effect.gen(function* () {
        const paths = yield* resolvePaths(configPath);
        yield* bindStatusServer(paths);
        yield* writeServerManifest(paths, { sessionId: "active-status" });

        const report = yield* reportForConfig(configPath, true);
        const human = renderStatus(report, "human");
        const json = renderStatus(report, "json");

        expect(report._tag).toBe("Running");
        expect(human).toContain("xmux server: ready");
        expect(human).toContain("session: active-status");
        expect(human).not.toContain(paths.configPath);
        expect(human).not.toContain(paths.socketPath);
        expect(human).not.toContain(paths.manifestPath);
        expect(human).toContain("orchestrator: running");
        expect(human).toContain("telegram: active");
        expect(human).toContain("pi: configured_lazy");
        expect(json).toContain('"status": "running"');
        expect(json).toContain('"state": "ready"');
        expect(json).toContain('"orchestrator"');
        expect(json).toContain('"harnesses"');
        expectValidJson(json);
      }),
    ),
  );

  posixIt("defaults missing legacy orchestrator status to unknown", () =>
    withStatusSandbox(({ configPath }) =>
      Effect.gen(function* () {
        const paths = yield* resolvePaths(configPath);
        yield* bindLegacyStatusServer(paths);
        yield* writeServerManifest(paths, { sessionId: "legacy-status" });

        const report = yield* reportForConfig(configPath, true);
        const human = renderStatus(report, "human");
        const json = renderStatus(report, "json");

        expect(report._tag).toBe("Running");
        expect(human).toContain("orchestrator: not_started");
        expect(json).toContain('"activation": "unknown"');
        expectValidJson(json);
      }),
    ),
  );

  posixIt("renders failed adapter reason without raw secret messages", () =>
    withStatusSandbox(({ configPath }) =>
      Effect.gen(function* () {
        const paths = yield* resolvePaths(configPath);
        yield* bindStatusServer(
          paths,
          {
            state: "failed",
            activation: "enabled",
            chats: [{ id: "telegram", state: "failed", reason: "authentication_failed" }],
            harnesses: [{ id: "pi", state: "configured_lazy" }],
            reason: "OrchestratorStartupError",
          },
          "degraded",
        );
        yield* writeServerManifest(paths, { sessionId: "degraded-status" });

        const report = yield* reportForConfig(configPath, true);
        const human = renderStatus(report, "human");
        const json = renderStatus(report, "json");

        expect(human).toContain("xmux server: degraded");
        expect(human).toContain("orchestrator: failed");
        expect(human).toContain("telegram: failed (authentication_failed)");
        expect(human).not.toContain("secret-token-should-not-leak");
        expect(json).toContain('"reason": "authentication_failed"');
        expectValidJson(json);
      }),
    ),
  );

  posixIt("classifies status API failures through ControlClient errors", () =>
    withStatusSandbox(({ configPath }) =>
      Effect.gen(function* () {
        const paths = yield* resolvePaths(configPath);
        yield* bindHealthServer(paths.socketPath);
        yield* writeServerManifest(paths, { sessionId: "missing-status-route" });

        const exit = yield* Effect.exit(reportForConfig(configPath));

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const failure = Cause.squash(exit.cause);
          expect(failure).toHaveProperty("_tag", "CliControlRequestError");
        }
      }),
    ),
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
      const configSummary: ConfigSummaryService = {
        load: () => Effect.die("config summary should not be called"),
      };
      const layer = Layer.mergeAll(
        Layer.succeed(ControlDiscovery, discovery),
        Layer.succeed(ControlClient, client),
        Layer.succeed(ConfigSummary, configSummary),
      );

      const exit = yield* Effect.exit(
        getStatusReport({ configPath: Option.some(""), json: false }).pipe(Effect.provide(layer)),
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
