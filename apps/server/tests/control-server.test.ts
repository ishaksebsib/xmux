import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Duration, Effect, Fiber, Layer } from "effect";
import { StatusResponse } from "../src/api/groups/status/schemas";
import { shutdown as shutdownRoute } from "../src/api/groups/lifecycle/handlers";
import { status as statusRoute } from "../src/api/groups/status/handlers";
import { makeSecretResolverLayer } from "./support/secrets";
import { ServerConfig } from "../src/config/service";
import { LogReader } from "../src/logging/log-reader";
import type { ServerRuntimePaths } from "../src/server-control/paths";
import { resolvedPathFromString, RuntimePaths } from "../src/server-control/paths";
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

const makePaths = (
  root: string,
  overrides: {
    readonly configPath?: string;
    readonly manifestPath?: string;
    readonly startupLockPath?: string;
    readonly socketPath?: string;
  } = {},
): ServerRuntimePaths => ({
  configPath: resolvedPathFromString(overrides.configPath ?? join(root, "config.jsonc")),
  stateDir: resolvedPathFromString(join(root, "state")),
  runtimeDir: resolvedPathFromString(join(root, "runtime")),
  logDir: resolvedPathFromString(join(root, "logs")),
  dbPath: resolvedPathFromString(join(root, "state", "server.db")),
  manifestPath: resolvedPathFromString(overrides.manifestPath ?? join(root, "server.json")),
  startupLockPath: resolvedPathFromString(
    overrides.startupLockPath ?? join(root, "startup.lock"),
  ),
  controlEndpoint: {
    kind: "unix-socket",
    path: resolvedPathFromString(overrides.socketPath ?? join(root, "server.sock")),
  },
  scopeId: "testscope",
});

const makeServerTestLayer = (paths: ServerRuntimePaths) => {
  const base = Layer.mergeAll(
    nodeHostRuntimeLayer,
    NodeFileSystem.layer,
    NodePath.layer,
    secretLayer,
    nodeServerProbeLayer,
    Layer.succeed(RuntimePaths)(paths),
    Layer.succeed(ServerIdentity)({
      pid: process.pid,
      startedAt: fixedStartedAt,
      sessionId: "control-test",
    }),
  );
  const withConfig = Layer.provideMerge(ServerConfig.layer, base);
  const withLogReader = Layer.provideMerge(LogReader.layer, withConfig);
  const withRuntime = Layer.mergeAll(withLogReader, StatusRegistry.layer, ShutdownCoordinator.layer);

  return Layer.provideMerge(nodeUnixSocketControlTransportLayer, withRuntime);
};

describe("control handlers", () => {
  it.effect("returns schema-valid status and idempotent shutdown responses", () =>
    Effect.gen(function* () {
      const root = yield* makeTempRoot;
      const paths = makePaths(root);
      const handlerLayer = Layer.mergeAll(
        StatusRegistry.layer,
        ShutdownCoordinator.layer,
        Layer.succeed(RuntimePaths)(paths),
        Layer.succeed(ServerIdentity)({
          pid: process.pid,
          startedAt: fixedStartedAt,
          sessionId: "unit",
        }),
      );

      yield* Effect.gen(function* () {
        const status = yield* StatusRegistry;
        const shutdown = yield* ShutdownCoordinator;
        yield* status.setState("ready");

        const statusBody = yield* statusRoute();
        if (!(statusBody instanceof StatusResponse)) {
          assert.fail("Expected direct status response value");
          return;
        }
        assert.strictEqual(statusBody.state, "ready");
        assert.strictEqual(statusBody.endpoint.path, paths.controlEndpoint.path);

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
  "defaultWorkingDirectory": "./workspace",
  "chats": {
    "telegram": {
      "enabled": true,
      "token": { "value": "inline-telegram-token" }
    }
  }
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
      assert.strictEqual(status.endpoint.path, socketPath);
      assert.strictEqual(status.configPath, configPath);

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
      assert.strictEqual(effectiveConfig.config.defaultWorkingDirectory, join(root, "workspace"));
      assert.strictEqual(effectiveConfig.config.chats.telegram.token?.source, "value");

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

      yield* Effect.promise(() => writeFile(configPath, `{ "server": { "logLevel": "verbose" } }`));
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
});
