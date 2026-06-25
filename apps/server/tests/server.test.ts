import { mkdtemp, rm, access, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, it } from "@effect/vitest";
import { Effect, Fiber, Layer } from "effect";
import { testOrchestratorFactoryLayer } from "./support/orchestrator";
import { makeSecretResolverLayer } from "./support/secrets";
import { ServerConfig } from "../src/config/service";
import { LogReader } from "../src/logging/log-reader";
import { nodeHostRuntimeLayer } from "../src/platform/node";
import { ServerIdentity } from "../src/server-runtime/identity";
import { ShutdownCoordinator } from "../src/server-runtime/shutdown-coordinator";
import { StatusRegistry } from "../src/server-runtime/state";
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
import { ServerProbe } from "../src/server-control/ports";
import { ControlTransport, serverMain } from "../src/server";

const fixedStartedAt = new Date("2026-06-16T00:00:00.000Z");
const testTransport = Layer.succeed(ControlTransport)({ bind: () => Effect.void });
const secretLayer = makeSecretResolverLayer(new Map());
const serverProbeUnreachableLayer = Layer.succeed(ServerProbe)({
  isAlive: () => Effect.succeed(false),
});

const makeTempRoot = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "server-boundary-"))),
  (path) => Effect.promise(() => rm(path, { recursive: true, force: true })).pipe(Effect.ignore),
);

const exists = (path: string): Effect.Effect<boolean> =>
  Effect.promise(() =>
    access(path).then(
      () => true,
      () => false,
    ),
  );

const makePaths = (
  root: string,
  configPath: string = join(root, "config.jsonc"),
): ServerRuntimePaths => ({
  configPath: configPathFromString(configPath),
  stateDir: stateDirFromString(join(root, "state")),
  runtimeDir: runtimeDirFromString(join(root, "runtime")),
  logDir: logDirFromString(join(root, "logs")),
  dbPath: databasePathFromString(join(root, "state", "server.db")),
  manifestPath: manifestPathFromString(join(root, "server.json")),
  startupLockPath: startupLockPathFromString(join(root, "startup.lock")),
  controlEndpoint: {
    kind: "unix-socket",
    path: unixSocketPathFromString(join(root, "server.sock")),
  },
  scopeId: scopeIdFromString("testscope"),
});

const makeTestLayer = (paths: ServerRuntimePaths) => {
  const base = Layer.mergeAll(
    nodeHostRuntimeLayer,
    NodeFileSystem.layer,
    NodePath.layer,
    secretLayer,
    testOrchestratorFactoryLayer,
    serverProbeUnreachableLayer,
    Layer.succeed(RuntimePaths)(paths),
    Layer.succeed(ServerIdentity)({
      pid: processIdFromNumber(process.pid),
      startedAt: fixedStartedAt,
      startedAtIso: isoTimestampFromString(fixedStartedAt.toISOString()),
      sessionId: sessionIdFromString("unit"),
    }),
  );
  const withConfig = Layer.provideMerge(ServerConfig.layer, base);
  const withLogReader = Layer.provideMerge(LogReader.layer, withConfig);

  return Layer.mergeAll(
    withLogReader,
    StatusRegistry.layer,
    ShutdownCoordinator.layer,
    testTransport,
  );
};

it.effect("constructs the server program with injected runtime services", () =>
  Effect.gen(function* () {
    const root = yield* makeTempRoot;
    const paths = makePaths(root);

    yield* Effect.scoped(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkScoped(Effect.scoped(serverMain()));
        const shutdown = yield* ShutdownCoordinator;
        yield* shutdown.completeShutdown();
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
        yield* shutdown.completeShutdown();
        yield* Fiber.join(fiber);
      }).pipe(Effect.provide(makeTestLayer(paths))),
    );

    assert.isFalse(yield* exists(paths.manifestPath));
  }),
);
