import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { assert, describe, it } from "@effect/vitest";
import { Result, XmuxInitializeError } from "@xmux/orchestrator";
import { Duration, Effect, Fiber, Layer } from "effect";
import { StatusResponse } from "../src/api/groups/status/schemas";
import { shutdown as shutdownRoute } from "../src/api/groups/lifecycle/handlers";
import { status as statusRoute } from "../src/api/groups/status/handlers";
import {
  makeTestOrchestratorFactoryLayer,
  testOrchestratorFactoryLayer,
} from "./support/orchestrator";
import { makeSecretResolverLayer } from "./support/secrets";
import { ServerConfig } from "../src/config/service";
import { LogReader } from "../src/logging/log-reader";
import {
  configPathFromString,
  databasePathFromString,
  isoTimestampFromString,
  logDirFromString,
  manifestPathFromString,
  processIdFromNumber,
  runtimeDirFromString,
  scopeIdFromString,
  sessionIdFromString,
  startupLockPathFromString,
  stateDirFromString,
  unixSocketPathFromString,
} from "../src/contracts/primitives";
import type { ServerRuntimePaths } from "../src/server-control/paths";
import { RuntimePaths } from "../src/server-control/paths";
import { OrchestratorFactory } from "../src/orchestrator/factory";
import { safeStatusReasonFromString } from "../src/orchestrator/status-model";
import { OrchestratorStatusRegistry } from "../src/orchestrator/status-registry";
import { ServerIdentity } from "../src/server-runtime/identity";
import { ShutdownCoordinator } from "../src/server-runtime/shutdown-coordinator";
import { StatusRegistry } from "../src/server-runtime/state";
import {
  nodeHostRuntimeLayer,
  nodeServerProbeLayer,
  nodeUnixSocketControlTransportLayer,
} from "../src/platform/node";
import { serverMain } from "../src/server";
import {
  getEffectiveConfig,
  getHealth,
  getStatus,
  requestRawUnixHttp,
  requestShutdown,
  tailLogs,
  validateConfig,
} from "./support/client";

const fixedStartedAt = new Date("2026-06-16T00:00:00.000Z");
const secretLayer = makeSecretResolverLayer(new Map());

const makeTempRoot = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "server-control-"))),
  (path) => Effect.promise(() => rm(path, { recursive: true, force: true })).pipe(Effect.ignore),
);

const exists = (path: string): Effect.Effect<boolean> =>
  Effect.promise(() =>
    access(path).then(
      () => true,
      () => false,
    ),
  );

const waitForPath = (path: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (yield* exists(path)) return;
      yield* Effect.sleep(Duration.millis(10));
    }
    assert.fail(`Timed out waiting for path: ${path}`);
  });

const waitForMissingPath = (path: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (!(yield* exists(path))) return;
      yield* Effect.sleep(Duration.millis(10));
    }
    assert.fail(`Timed out waiting for path removal: ${path}`);
  });

const waitForStatusState = (socketPath: string, state: string) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const status = yield* getStatus(socketPath);
      if (status.state === state) return status;
      yield* Effect.sleep(Duration.millis(10));
    }
    assert.fail(`Timed out waiting for status state: ${state}`);
  });

const requireOrchestrator = (status: StatusResponse) => {
  if (status.orchestrator === undefined) {
    assert.fail("Expected orchestrator status to be present");
  }
  return status.orchestrator;
};

const makePaths = (
  root: string,
  overrides: {
    readonly configPath?: string;
    readonly manifestPath?: string;
    readonly startupLockPath?: string;
    readonly socketPath?: string;
  } = {},
): ServerRuntimePaths => ({
  configPath: configPathFromString(overrides.configPath ?? join(root, "config.jsonc")),
  stateDir: stateDirFromString(join(root, "state")),
  runtimeDir: runtimeDirFromString(join(root, "runtime")),
  logDir: logDirFromString(join(root, "logs")),
  dbPath: databasePathFromString(join(root, "state", "server.db")),
  manifestPath: manifestPathFromString(overrides.manifestPath ?? join(root, "server.json")),
  startupLockPath: startupLockPathFromString(
    overrides.startupLockPath ?? join(root, "startup.lock"),
  ),
  controlEndpoint: {
    kind: "unix-socket",
    path: unixSocketPathFromString(overrides.socketPath ?? join(root, "server.sock")),
  },
  scopeId: scopeIdFromString("testscope"),
});

const makeServerTestLayer = (
  paths: ServerRuntimePaths,
  factoryLayer: Layer.Layer<OrchestratorFactory> = testOrchestratorFactoryLayer,
) => {
  const base = Layer.mergeAll(
    nodeHostRuntimeLayer,
    NodeFileSystem.layer,
    NodePath.layer,
    secretLayer,
    factoryLayer,
    nodeServerProbeLayer,
    Layer.succeed(RuntimePaths)(paths),
    Layer.succeed(ServerIdentity)({
      pid: processIdFromNumber(process.pid),
      startedAt: fixedStartedAt,
      startedAtIso: isoTimestampFromString(fixedStartedAt.toISOString()),
      sessionId: sessionIdFromString("control-test"),
    }),
  );
  const withConfig = Layer.provideMerge(ServerConfig.layer, base);
  const withLogReader = Layer.provideMerge(LogReader.layer, withConfig);
  const withRuntime = Layer.mergeAll(
    withLogReader,
    StatusRegistry.layer,
    OrchestratorStatusRegistry.layer,
    ShutdownCoordinator.layer,
  );

  return Layer.provideMerge(nodeUnixSocketControlTransportLayer, withRuntime);
};

describe("status transitions", () => {
  it.effect("rejects illegal transitions with StatusTransitionError", () =>
    Effect.gen(function* () {
      const registry = yield* StatusRegistry;
      const error = yield* registry.beginReload().pipe(Effect.flip);
      assert.strictEqual(error._tag, "StatusTransitionError");
      assert.strictEqual(error.from, "starting");
      assert.strictEqual(error.to, "reloading");
    }).pipe(Effect.provide(StatusRegistry.layer)),
  );
});

describe("control handlers", () => {
  it.effect("returns schema-valid status and idempotent shutdown responses", () =>
    Effect.gen(function* () {
      const root = yield* makeTempRoot;
      const paths = makePaths(root);
      const handlerLayer = Layer.mergeAll(
        StatusRegistry.layer,
        OrchestratorStatusRegistry.layer,
        ShutdownCoordinator.layer,
        Layer.succeed(RuntimePaths)(paths),
        Layer.succeed(ServerIdentity)({
          pid: processIdFromNumber(process.pid),
          startedAt: fixedStartedAt,
          startedAtIso: isoTimestampFromString(fixedStartedAt.toISOString()),
          sessionId: sessionIdFromString("unit"),
        }),
      );

      yield* Effect.gen(function* () {
        const status = yield* StatusRegistry;
        const shutdown = yield* ShutdownCoordinator;
        yield* status.markReady();

        const statusBody = yield* statusRoute();
        if (!(statusBody instanceof StatusResponse)) {
          assert.fail("Expected direct status response value");
          return;
        }
        const orchestrator = requireOrchestrator(statusBody);
        assert.strictEqual(statusBody.state, "ready");
        assert.strictEqual(statusBody.endpoint.path, paths.controlEndpoint.path);
        assert.strictEqual(orchestrator.state, "not_started");
        assert.strictEqual(orchestrator.activation, "unknown");
        assert.deepStrictEqual([...orchestrator.chats], []);
        assert.deepStrictEqual([...orchestrator.harnesses], []);

        const firstShutdownBody = yield* Effect.scoped(shutdownRoute());
        assert.isTrue(firstShutdownBody.accepted);
        assert.isFalse(firstShutdownBody.alreadyStopping);

        const secondShutdownBody = yield* Effect.scoped(shutdownRoute());
        assert.isFalse(secondShutdownBody.accepted);
        assert.isTrue(secondShutdownBody.alreadyStopping);
        assert.isTrue(yield* shutdown.isShutdownRequested());
      }).pipe(Effect.provide(handlerLayer));
    }),
  );
});

describe("control server", () => {
  it.live("serves health/status and shuts down over a Unix socket", () =>
    Effect.gen(function* () {
      const root = yield* makeTempRoot;
      const configPath = join(root, "config.jsonc");
      const socketPath = join(root, "runtime", "server.sock");
      const manifestPath = join(root, "server.json");
      const startupLockPath = join(root, "startup.lock");
      const paths = makePaths(root, { configPath, manifestPath, startupLockPath, socketPath });
      yield* Effect.promise(() =>
        writeFile(
          configPath,
          `{
  "xmux": { "workspace": { "defaultDir": "./workspace" } },
  "chats": {
    "telegram": {
      "token": { "value": "inline-telegram-token" },
      "access": { "type": "anyone" }
    }
  },
  "harnesses": { "opencode": { "runtime": { "type": "embedded" } } }
}`,
        ),
      );

      const fiber = yield* Effect.forkScoped(
        Effect.scoped(serverMain()).pipe(Effect.provide(makeServerTestLayer(paths))),
      );

      yield* waitForPath(manifestPath);
      yield* waitForPath(socketPath);
      yield* waitForMissingPath(startupLockPath);

      const health = yield* getHealth(socketPath);
      assert.isTrue(health.alive);
      assert.isTrue(health.ready);
      assert.strictEqual(health.state, "ready");

      const status = yield* getStatus(socketPath);
      assert.strictEqual(status.state, "ready");
      const orchestrator = requireOrchestrator(status);
      assert.strictEqual(status.endpoint.path, socketPath);
      assert.strictEqual(status.configPath, configPath);
      assert.strictEqual(orchestrator.state, "running");
      assert.deepStrictEqual(
        orchestrator.chats.map((adapter) => ({ id: adapter.id, state: adapter.state })),
        [{ id: "telegram", state: "active" }],
      );
      assert.deepStrictEqual(
        orchestrator.harnesses.map((adapter) => ({ id: adapter.id, state: adapter.state })),
        [{ id: "opencode", state: "configured_lazy" }],
      );

      const missingResponse = yield* requestRawUnixHttp({
        socketPath,
        method: "GET",
        path: "/missing",
      });
      assert.strictEqual(missingResponse.statusCode, 404);

      const methodResponse = yield* requestRawUnixHttp({
        socketPath,
        method: "POST",
        path: "/healthz",
      });
      assert.strictEqual(methodResponse.statusCode, 404);

      const effectiveConfig = yield* getEffectiveConfig(socketPath);
      assert.strictEqual(effectiveConfig.config.xmux.workspace.defaultDir, join(root, "workspace"));
      const telegramConfig = effectiveConfig.config.chats.telegram;
      if (telegramConfig === undefined) {
        assert.fail("Expected Telegram config to be present");
      }
      assert.strictEqual(telegramConfig.token.source, "value");

      const configResponse = yield* requestRawUnixHttp({
        socketPath,
        method: "GET",
        path: "/v1/config/effective",
      });
      assert.notInclude(configResponse.body, "inline-telegram-token");

      const validation = yield* validateConfig(socketPath);
      assert.isTrue(validation.valid);

      const duplicateError = yield* Effect.scoped(serverMain()).pipe(
        Effect.provide(makeServerTestLayer(paths)),
        Effect.flip,
      );
      assert.strictEqual(duplicateError._tag, "ActiveServerError");

      yield* Effect.promise(() =>
        writeFile(configPath, `{ "server": { "logs": { "level": "verbose" } } }`),
      );
      const invalidValidateResponse = yield* requestRawUnixHttp({
        socketPath,
        method: "POST",
        path: "/v1/config/validate",
      });
      assert.strictEqual(invalidValidateResponse.statusCode, 200);
      const invalidValidation = yield* validateConfig(socketPath);
      assert.isFalse(invalidValidation.valid);

      yield* Effect.sleep(Duration.millis(150));
      const logs = yield* tailLogs(socketPath, 5);
      assert.isAtMost(logs.entries.length, 5);

      const logsResponse = yield* requestRawUnixHttp({
        socketPath,
        method: "GET",
        path: "/v1/logs?tail=5",
      });
      assert.notInclude(logsResponse.body, "inline-telegram-token");

      const shutdown = yield* requestShutdown(socketPath);
      assert.isTrue(shutdown.accepted);
      assert.isFalse(shutdown.alreadyStopping);

      yield* Fiber.join(fiber);
      assert.isFalse(yield* exists(manifestPath));
      assert.isFalse(yield* exists(socketPath));
      assert.isFalse(yield* exists(startupLockPath));
    }),
  );

  it.live("serves degraded status when orchestrator initialization fails", () =>
    Effect.gen(function* () {
      const root = yield* makeTempRoot;
      const configPath = join(root, "config.jsonc");
      const socketPath = join(root, "runtime", "degraded.sock");
      const manifestPath = join(root, "degraded.json");
      const paths = makePaths(root, { configPath, manifestPath, socketPath });
      yield* Effect.promise(() =>
        writeFile(
          configPath,
          `{
  "xmux": { "workspace": { "defaultDir": "./workspace" } },
  "chats": {
    "telegram": {
      "token": { "value": "inline-telegram-token" },
      "access": { "type": "anyone" }
    }
  },
  "harnesses": { "opencode": { "runtime": { "type": "embedded" } } }
}`,
        ),
      );
      const factoryLayer = makeTestOrchestratorFactoryLayer({
        status: () => ({
          chats: {
            lifecycle: "created",
            adapters: [{ id: "telegram", state: "failed", reason: "ChatAdapterOpenError" }],
          },
          harnesses: { adapters: [{ id: "opencode", state: "configured_lazy" }] },
        }),
        initialize: () =>
          Promise.resolve(
            Result.err<void, XmuxInitializeError>(
              new XmuxInitializeError({ cause: new Error("secret-token-should-not-leak") }),
            ),
          ),
      });
      const fiber = yield* Effect.forkScoped(
        Effect.scoped(serverMain()).pipe(Effect.provide(makeServerTestLayer(paths, factoryLayer))),
      );

      yield* waitForPath(socketPath);
      yield* waitForPath(manifestPath);

      const status = yield* waitForStatusState(socketPath, "degraded");
      const orchestrator = requireOrchestrator(status);
      assert.strictEqual(status.state, "degraded");
      assert.strictEqual(orchestrator.state, "degraded");
      assert.deepStrictEqual(
        orchestrator.chats.map((adapter) => ({
          id: adapter.id,
          state: adapter.state,
          reason: adapter.reason,
        })),
        [
          {
            id: "telegram",
            state: "failed",
            reason: safeStatusReasonFromString("ChatAdapterOpenError"),
          },
        ],
      );
      assert.notInclude(JSON.stringify(status), "secret-token-should-not-leak");

      const health = yield* getHealth(socketPath);
      assert.isTrue(health.alive);
      assert.isTrue(health.ready);
      assert.strictEqual(health.state, "degraded");

      const shutdown = yield* requestShutdown(socketPath);
      assert.isTrue(shutdown.accepted);
      yield* Fiber.join(fiber);
    }),
  );
});
