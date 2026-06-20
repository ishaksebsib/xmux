import { request as httpRequest } from "node:http";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Duration, Effect, Fiber, Layer, Option, Schema } from "effect";
import { ConfigValidateResponse, EffectiveConfigResponse } from "../src/api/groups/config/schemas";
import { LogsResponse } from "../src/api/groups/log/schemas";
import { ShutdownResponse } from "../src/api/groups/lifecycle/schemas";
import { StatusResponse } from "../src/api/groups/status/schemas";
import { HealthResponse } from "../src/api/groups/system/schemas";
import { shutdown as shutdownRoute } from "../src/api/groups/lifecycle/handlers";
import { status as statusRoute } from "../src/api/groups/status/handlers";
import { makeSecretResolverLayer } from "../src/config/resolve-secrets";
import { ServerConfigLayer } from "../src/config/service";
import { LogReaderLayer } from "../src/logging/log-reader";
import type { ServerRuntimePaths } from "../src/runtime-state/paths";
import { RuntimePaths } from "../src/runtime-state/runtime-paths-service";
import { ServerIdentity } from "../src/services/server-identity";
import {
  ShutdownCoordinator,
  ShutdownCoordinatorLayer,
} from "../src/services/shutdown-coordinator";
import { StatusRegistry, StatusRegistryLayer } from "../src/services/status-registry";
import { unixSocketFetch } from "../src/api/client";
import {
  NodeHostRuntime,
  NodeServerProbe,
  NodeUnixSocketControlTransport,
} from "../src/platform/node";
import { serverMain } from "../src/server";

const fixedStartedAt = new Date("2026-06-16T00:00:00.000Z");
const SecretLayer = makeSecretResolverLayer(new Map());

interface HttpTestResponse {
  readonly statusCode: number;
  readonly body: string;
}

class UnixSocketRequestError extends Schema.TaggedErrorClass<UnixSocketRequestError>()(
  "UnixSocketRequestError",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Unknown),
  },
) {}

const decodeUnknownJsonOption = Schema.decodeUnknownOption(Schema.UnknownFromJsonString);
const decodeHealthResponse = Schema.decodeUnknownOption(HealthResponse);
const decodeStatusResponse = Schema.decodeUnknownOption(StatusResponse);
const decodeShutdownResponse = Schema.decodeUnknownOption(ShutdownResponse);
const decodeEffectiveConfigResponse = Schema.decodeUnknownOption(EffectiveConfigResponse);
const decodeConfigValidateResponse = Schema.decodeUnknownOption(ConfigValidateResponse);
const decodeLogsResponse = Schema.decodeUnknownOption(LogsResponse);

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

const requestUnix = (
  socketPath: string,
  method: string,
  path: string,
): Effect.Effect<HttpTestResponse, UnixSocketRequestError> =>
  Effect.tryPromise({
    try: () =>
      new Promise<HttpTestResponse>((resolve, reject) => {
        const request = httpRequest(
          {
            method,
            path,
            socketPath,
          },
          (response) => {
            const chunks: Array<string> = [];
            response.setEncoding("utf8");
            response.on("data", (chunk: string) => {
              chunks.push(chunk);
            });
            response.on("end", () => {
              resolve({
                statusCode: response.statusCode ?? 0,
                body: chunks.join(""),
              });
            });
          },
        );
        request.on("error", (cause: Error) => {
          reject(cause);
        });
        request.end();
      }),
    catch: (cause) =>
      new UnixSocketRequestError({
        message: "Unix socket request failed.",
        cause,
      }),
  });

const decodeHealth = (body: string): HealthResponse => {
  const json = decodeUnknownJsonOption(body);
  if (Option.isNone(json)) assert.fail("Expected JSON health response");
  const decoded = decodeHealthResponse(json.value);
  if (Option.isNone(decoded)) assert.fail("Expected schema-valid health response");
  return decoded.value;
};

const decodeStatus = (body: string): StatusResponse => {
  const json = decodeUnknownJsonOption(body);
  if (Option.isNone(json)) assert.fail("Expected JSON status response");
  const decoded = decodeStatusResponse(json.value);
  if (Option.isNone(decoded)) assert.fail("Expected schema-valid status response");
  return decoded.value;
};

const decodeEffectiveConfig = (body: string): EffectiveConfigResponse => {
  const json = decodeUnknownJsonOption(body);
  if (Option.isNone(json)) assert.fail("Expected JSON effective config response");
  const decoded = decodeEffectiveConfigResponse(json.value);
  if (Option.isNone(decoded)) assert.fail("Expected schema-valid effective config response");
  return decoded.value;
};

const decodeConfigValidate = (body: string): ConfigValidateResponse => {
  const json = decodeUnknownJsonOption(body);
  if (Option.isNone(json)) assert.fail("Expected JSON config validation response");
  const decoded = decodeConfigValidateResponse(json.value);
  if (Option.isNone(decoded)) assert.fail("Expected schema-valid config validation response");
  return decoded.value;
};

const decodeLogs = (body: string): LogsResponse => {
  const json = decodeUnknownJsonOption(body);
  if (Option.isNone(json)) assert.fail("Expected JSON logs response");
  const decoded = decodeLogsResponse(json.value);
  if (Option.isNone(decoded)) assert.fail("Expected schema-valid logs response");
  return decoded.value;
};

const decodeShutdown = (body: string): ShutdownResponse => {
  const json = decodeUnknownJsonOption(body);
  if (Option.isNone(json)) assert.fail("Expected JSON shutdown response");
  const decoded = decodeShutdownResponse(json.value);
  if (Option.isNone(decoded)) assert.fail("Expected schema-valid shutdown response");
  return decoded.value;
};

const makePaths = (
  root: string,
  overrides: Partial<
    Pick<ServerRuntimePaths, "configPath" | "manifestPath" | "startupLockPath">
  > & {
    readonly socketPath?: string;
  } = {},
): ServerRuntimePaths => ({
  configPath: overrides.configPath ?? join(root, "config.jsonc"),
  stateDir: join(root, "state"),
  runtimeDir: join(root, "runtime"),
  logDir: join(root, "logs"),
  dbPath: join(root, "state", "server.db"),
  manifestPath: overrides.manifestPath ?? join(root, "server.json"),
  startupLockPath: overrides.startupLockPath ?? join(root, "startup.lock"),
  controlEndpoint: {
    kind: "unix-socket",
    path: overrides.socketPath ?? join(root, "server.sock"),
  },
  scopeId: "testscope",
});

const makeServerTestLayer = (paths: ServerRuntimePaths) => {
  const base = Layer.mergeAll(
    NodeHostRuntime,
    NodeFileSystem.layer,
    NodePath.layer,
    SecretLayer,
    NodeServerProbe,
    Layer.succeed(RuntimePaths)(paths),
    Layer.succeed(ServerIdentity)({
      pid: process.pid,
      startedAt: fixedStartedAt,
      sessionId: "control-test",
    }),
  );
  const withConfig = Layer.provideMerge(ServerConfigLayer, base);
  const withLogReader = Layer.provideMerge(LogReaderLayer, withConfig);
  const withRuntime = Layer.mergeAll(withLogReader, StatusRegistryLayer, ShutdownCoordinatorLayer);

  return Layer.provideMerge(NodeUnixSocketControlTransport, withRuntime);
};

describe("control handlers", () => {
  it.effect("returns schema-valid status and idempotent shutdown responses", () =>
    Effect.gen(function* () {
      const root = yield* makeTempRoot;
      const paths = makePaths(root);
      const handlerLayer = Layer.mergeAll(
        StatusRegistryLayer,
        ShutdownCoordinatorLayer,
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
        assert.isTrue(yield* shutdown.isShutdownRequested);
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
  "userName": "control-test",
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

      const healthResponse = yield* requestUnix(socketPath, "GET", "/healthz");
      assert.strictEqual(healthResponse.statusCode, 200);
      const health = decodeHealth(healthResponse.body);
      assert.isTrue(health.alive);
      assert.isTrue(health.ready);
      assert.strictEqual(health.state, "ready");

      const clientFetch = unixSocketFetch({ socketPath });
      const clientHealthResponse = yield* Effect.promise(() =>
        clientFetch("http://xmux.local/healthz"),
      );
      assert.strictEqual(clientHealthResponse.status, 200);
      const clientHealth = decodeHealth(yield* Effect.promise(() => clientHealthResponse.text()));
      assert.isTrue(clientHealth.alive);

      const statusResponse = yield* requestUnix(socketPath, "GET", "/v1/status");
      assert.strictEqual(statusResponse.statusCode, 200);
      const status = decodeStatus(statusResponse.body);
      assert.strictEqual(status.state, "ready");
      assert.strictEqual(status.endpoint.path, socketPath);
      assert.strictEqual(status.configPath, configPath);

      const missingResponse = yield* requestUnix(socketPath, "GET", "/missing");
      assert.strictEqual(missingResponse.statusCode, 404);

      const methodResponse = yield* requestUnix(socketPath, "POST", "/healthz");
      assert.strictEqual(methodResponse.statusCode, 404);

      const configResponse = yield* requestUnix(socketPath, "GET", "/v1/config/effective");
      assert.strictEqual(configResponse.statusCode, 200);
      const effectiveConfig = decodeEffectiveConfig(configResponse.body);
      assert.strictEqual(effectiveConfig.config.userName, "control-test");
      assert.strictEqual(effectiveConfig.config.chats.telegram.token?.source, "value");
      assert.notInclude(configResponse.body, "inline-telegram-token");

      const validateResponse = yield* requestUnix(socketPath, "POST", "/v1/config/validate");
      assert.strictEqual(validateResponse.statusCode, 200);
      const validation = decodeConfigValidate(validateResponse.body);
      assert.isTrue(validation.valid);

      const duplicateError = yield* Effect.scoped(serverMain()).pipe(
        Effect.provide(makeServerTestLayer(paths)),
        Effect.flip,
      );
      assert.strictEqual(duplicateError._tag, "ActiveServerError");

      yield* Effect.promise(() => writeFile(configPath, `{ "server": { "logLevel": "verbose" } }`));
      const invalidValidateResponse = yield* requestUnix(socketPath, "POST", "/v1/config/validate");
      assert.strictEqual(invalidValidateResponse.statusCode, 422);
      const invalidValidation = decodeConfigValidate(invalidValidateResponse.body);
      assert.isFalse(invalidValidation.valid);

      yield* Effect.sleep(Duration.millis(150));
      const logsResponse = yield* requestUnix(socketPath, "GET", "/v1/logs?tail=5");
      assert.strictEqual(logsResponse.statusCode, 200);
      const logs = decodeLogs(logsResponse.body);
      assert.isAtMost(logs.entries.length, 5);
      assert.notInclude(logsResponse.body, "inline-telegram-token");

      const shutdownResponse = yield* requestUnix(socketPath, "POST", "/v1/shutdown");
      assert.strictEqual(shutdownResponse.statusCode, 202);
      const shutdown = decodeShutdown(shutdownResponse.body);
      assert.isTrue(shutdown.accepted);
      assert.isFalse(shutdown.alreadyStopping);

      yield* Fiber.join(fiber);
      assert.isFalse(yield* exists(manifestPath));
      assert.isFalse(yield* exists(socketPath));
      assert.isFalse(yield* exists(startupLockPath));
    }),
  );
});
