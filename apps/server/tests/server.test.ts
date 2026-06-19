import { mkdtemp, rm, access, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, it } from "@effect/vitest";
import { Effect, Fiber, Layer } from "effect";
import { ServerBinding } from "../src/http/binding";
import { ServerIdentity } from "../src/runtime/server-identity";
import type { ServerRuntimePaths } from "../src/runtime-state/paths";
import { RuntimePaths } from "../src/runtime-state/runtime-paths-service";
import { ShutdownCoordinator } from "../src/runtime/shutdown-coordinator";
import { nodeServerServices, serverMain } from "../src/server";

const fixedStartedAt = new Date("2026-06-16T00:00:00.000Z");
const testBinding = Layer.succeed(ServerBinding)({ bind: Effect.void });

const makeTempRoot = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "server-boundary-"))),
  (path) => Effect.promise(() => rm(path, { recursive: true, force: true })).pipe(Effect.ignore),
);

const exists = (path: string): Effect.Effect<boolean> =>
  Effect.promise(() => access(path).then(() => true, () => false));

const makePaths = (root: string, configPath: string = join(root, "config.jsonc")): ServerRuntimePaths => ({
  configPath,
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

const makeTestLayer = (paths: ServerRuntimePaths) =>
  Layer.mergeAll(
    NodeFileSystem.layer,
    NodePath.layer,
    Layer.succeed(RuntimePaths)(paths),
    Layer.succeed(ServerIdentity)({
      pid: process.pid,
      startedAt: fixedStartedAt,
      sessionId: "unit",
    }),
    nodeServerServices,
    testBinding,
  );

it.effect("constructs the server program with injected runtime services", () =>
  Effect.gen(function* () {
    const root = yield* makeTempRoot;
    const paths = makePaths(root);

    yield* Effect.scoped(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkScoped(Effect.scoped(serverMain()));
        const shutdown = yield* ShutdownCoordinator;
        yield* shutdown.completeShutdown;
        yield* Fiber.join(fiber);
      }).pipe(Effect.provide(makeTestLayer(paths))),
    );

    assert.isFalse(yield* exists(paths.manifestPath));
    assert.isFalse(yield* exists(paths.startupLockPath));
    assert.isFalse(yield* exists(paths.controlEndpoint.path));
  }),
);

it.effect("fails config parse before publishing manifest or socket", () =>
  Effect.gen(function* () {
    const root = yield* makeTempRoot;
    const configPath = join(root, "config.jsonc");
    const paths = makePaths(root, configPath);
    yield* Effect.promise(() => writeFile(configPath, "{ invalid json }"));

    const error = yield* Effect.scoped(
      Effect.scoped(serverMain()).pipe(Effect.provide(makeTestLayer(paths))),
    ).pipe(Effect.flip);

    assert.strictEqual(error._tag, "ConfigParseError");
    assert.isFalse(yield* exists(paths.manifestPath));
    assert.isFalse(yield* exists(paths.controlEndpoint.path));
  }),
);

it.effect("runs the server workflow with injected temp runtime paths", () =>
  Effect.gen(function* () {
    const root = yield* makeTempRoot;
    const paths = makePaths(root);

    yield* Effect.scoped(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkScoped(Effect.scoped(serverMain()));
        const shutdown = yield* ShutdownCoordinator;
        yield* shutdown.completeShutdown;
        yield* Fiber.join(fiber);
      }).pipe(Effect.provide(makeTestLayer(paths))),
    );

    assert.isFalse(yield* exists(paths.manifestPath));
  }),
);
