import { request as httpRequest } from "node:http";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it, layer } from "@effect/vitest";
import { Duration, Effect, Fiber, Layer, Option, Schema } from "effect";
import {
  ControlErrorResponse,
  HealthResponse,
  ShutdownResponse,
  StatusResponse,
} from "../src/contracts/control";
import { routeControlRequest } from "../src/control/router";
import type { ServerRuntimePaths } from "../src/runtime-state/paths";
import { ShutdownCoordinator, ShutdownCoordinatorLive } from "../src/runtime/shutdown-coordinator";
import { StatusRegistry, StatusRegistryLive } from "../src/runtime/status-registry";
import { runXmuxServer } from "../src/server";

const fixedStartedAt = new Date("2026-06-16T00:00:00.000Z");
const fixedClock = {
  now: () => fixedStartedAt,
};

interface HttpTestResponse {
  readonly statusCode: number;
  readonly body: string;
}

const decodeUnknownJsonOption = Schema.decodeUnknownOption(Schema.UnknownFromJsonString);
const decodeHealthResponse = Schema.decodeUnknownOption(HealthResponse);
const decodeStatusResponse = Schema.decodeUnknownOption(StatusResponse);
const decodeShutdownResponse = Schema.decodeUnknownOption(ShutdownResponse);

const makeTempRoot = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "server-control-"))),
  (path) => Effect.promise(() => rm(path, { recursive: true, force: true })).pipe(Effect.ignore),
);

const exists = (path: string): Effect.Effect<boolean> =>
  Effect.promise(() => access(path).then(() => true, () => false));

const waitForPath = (path: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (yield* exists(path)) return;
      yield* Effect.sleep(Duration.millis(10));
    }
    assert.fail(`Timed out waiting for path: ${path}`);
  });

const requestUnix = (
  socketPath: string,
  method: string,
  path: string,
): Effect.Effect<HttpTestResponse, Error> =>
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
    catch: (cause) => new Error(`Unix socket request failed: ${String(cause)}`),
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

const decodeShutdown = (body: string): ShutdownResponse => {
  const json = decodeUnknownJsonOption(body);
  if (Option.isNone(json)) assert.fail("Expected JSON shutdown response");
  const decoded = decodeShutdownResponse(json.value);
  if (Option.isNone(decoded)) assert.fail("Expected schema-valid shutdown response");
  return decoded.value;
};

const makePaths = (root: string): ServerRuntimePaths => ({
  configPath: join(root, "config.jsonc"),
  stateDir: join(root, "state"),
  runtimeDir: join(root, "runtime"),
  logDir: join(root, "logs"),
  dbPath: join(root, "state", "server.db"),
  manifestPath: join(root, "server.json"),
  startupLockPath: join(root, "startup.lock"),
  controlEndpoint: {
    kind: "unix-socket",
    path: join(root, "server.sock"),
  },
  scopeId: "testscope",
});

describe("control router", () => {
  layer(Layer.mergeAll(StatusRegistryLive, ShutdownCoordinatorLive))((it) => {
    it.effect("returns schema-valid status and idempotent shutdown responses", () =>
      Effect.gen(function* () {
        const root = yield* makeTempRoot;
        const paths = makePaths(root);
        const status = yield* StatusRegistry;
        const shutdown = yield* ShutdownCoordinator;
        yield* status.setState("ready");

        const statusRoute = yield* routeControlRequest({
          method: "GET",
          url: "/v1/status",
          paths,
          startedAt: fixedStartedAt,
          clock: fixedClock,
        });
        assert.strictEqual(statusRoute.response.statusCode, 200);
        const statusBody = statusRoute.response.body;
        assert.instanceOf(statusBody, StatusResponse);
        assert.strictEqual(statusBody.state, "ready");
        if (paths.controlEndpoint.kind !== "unix-socket") {
          assert.fail("Expected Unix socket endpoint");
          return;
        }
        assert.strictEqual(statusBody.endpoint.path, paths.controlEndpoint.path);

        const firstShutdown = yield* routeControlRequest({
          method: "POST",
          url: "/v1/shutdown",
          paths,
          startedAt: fixedStartedAt,
          clock: fixedClock,
        });
        const firstShutdownBody = firstShutdown.response.body;
        assert.instanceOf(firstShutdownBody, ShutdownResponse);
        assert.isTrue(firstShutdownBody.accepted);
        assert.isFalse(firstShutdownBody.alreadyStopping);

        const secondShutdown = yield* routeControlRequest({
          method: "POST",
          url: "/v1/shutdown",
          paths,
          startedAt: fixedStartedAt,
          clock: fixedClock,
        });
        const secondShutdownBody = secondShutdown.response.body;
        assert.instanceOf(secondShutdownBody, ShutdownResponse);
        assert.isFalse(secondShutdownBody.accepted);
        assert.isTrue(secondShutdownBody.alreadyStopping);
        assert.isTrue(yield* shutdown.isShutdownRequested);

        const missingRoute = yield* routeControlRequest({
          method: "GET",
          url: "/missing",
          paths,
          startedAt: fixedStartedAt,
          clock: fixedClock,
        });
        assert.strictEqual(missingRoute.response.statusCode, 404);
        assert.instanceOf(missingRoute.response.body, ControlErrorResponse);
      }),
    );
  });
});

describe("control server", () => {
  it.live("serves health/status and shuts down over a Unix socket", () =>
    Effect.gen(function* () {
      const root = yield* makeTempRoot;
      const socketPath = join(root, "runtime", "server.sock");
      const manifestPath = join(root, "server.json");
      const startupLockPath = join(root, "startup.lock");

      const fiber = yield* Effect.forkScoped(
        runXmuxServer({
          configPath: join(root, "config.jsonc"),
          pathOverrides: {
            stateDir: join(root, "state"),
            runtimeDir: join(root, "runtime"),
            logDir: join(root, "logs"),
            dbPath: join(root, "state", "server.db"),
            manifestPath,
            startupLockPath,
          },
          controlEndpointOverride: { kind: "unix-socket", path: socketPath },
          clock: fixedClock,
          shutdownSignal: Effect.never,
        }),
      );

      yield* waitForPath(manifestPath);
      yield* waitForPath(socketPath);
      assert.isTrue(yield* exists(startupLockPath));

      const healthResponse = yield* requestUnix(socketPath, "GET", "/healthz");
      assert.strictEqual(healthResponse.statusCode, 200);
      const health = decodeHealth(healthResponse.body);
      assert.isTrue(health.alive);
      assert.isTrue(health.ready);
      assert.strictEqual(health.state, "ready");

      const statusResponse = yield* requestUnix(socketPath, "GET", "/v1/status");
      assert.strictEqual(statusResponse.statusCode, 200);
      const status = decodeStatus(statusResponse.body);
      assert.strictEqual(status.state, "ready");
      assert.strictEqual(status.endpoint.path, socketPath);
      assert.strictEqual(status.configPath, join(root, "config.jsonc"));

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
