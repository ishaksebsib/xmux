import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Layer, Option, Scope } from "effect";
import { getStatusReport } from "../src/commands/status";
import { ControlClient, type ControlClientService } from "../src/control/client";
import { ControlDiscovery, type ControlDiscoveryService } from "../src/control/discovery";
import { nodeControlClientLayer } from "../src/platform/node/control-client";
import { nodeControlDiscoveryLayer } from "../src/platform/node/control-discovery";
import { CliInvalidInput } from "../src/domain/errors";
import { renderCliCause } from "../src/output/errors";
import { renderStatus, renderStatusJson } from "../src/output/status";
import { cliRuntimeEnvForRoot, withEnvVars } from "./support/env";
import { makeCliSandbox, writeText } from "./support/sandbox";
import {
  bindHealthServer,
  bindStatusServer,
  resolvePaths,
  writeServerManifest,
} from "./support/discovery";

const posixIt = process.platform === "win32" ? it.live.skip : it.live;

const statusLayer = Layer.mergeAll(nodeControlDiscoveryLayer, nodeControlClientLayer);

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

const expectValidJson = (output: string): void => {
  expect(() => JSON.parse(output)).not.toThrow();
};

describe.sequential("status command", () => {
  posixIt("renders stopped/no manifest status successfully", () =>
    withStatusSandbox(({ configPath }) =>
      Effect.gen(function* () {
        const report = yield* reportForConfig(configPath);
        const human = renderStatus(report, "human");
        const json = renderStatusJson(report);

        expect(report._tag).toBe("Stopped");
        expect(human).toContain("xmux server: stopped");
        expect(human).toContain("reason: no-manifest");
        expect(json).toContain('"status": "stopped"');
        expectValidJson(json);
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
        expect(json).toContain('"status": "running"');
        expect(json).toContain('"state": "ready"');
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
      const layer = Layer.mergeAll(
        Layer.succeed(ControlDiscovery, discovery),
        Layer.succeed(ControlClient, client),
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
