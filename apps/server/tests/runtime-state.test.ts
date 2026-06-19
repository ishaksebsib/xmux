import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, layer } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";
import {
  API_VERSION,
  SERVER_MANIFEST_VERSION,
  SERVER_PACKAGE_VERSION,
} from "../src/contracts/constants";
import { ManifestEndpoint, ServerManifest, ServerOwnerMetadata } from "../src/contracts/manifest";
import { normalizeServerOptions } from "../src/options";
import { assertNoActiveServer } from "../src/runtime-state/active-server";
import { ServerProbe } from "../src/runtime-state/server-probe";
import {
  acquireManifestOwnership,
  createServerManifest,
  parseServerManifest,
  readServerManifest,
  removeServerManifestIfOwnedBy,
  serializeServerManifest,
  writeServerManifest,
} from "../src/runtime-state/manifest";
import { createScopeId, resolveRuntimePaths, type ServerRuntimePaths } from "../src/runtime-state/paths";
import { isPidAlive } from "../src/runtime-state/pid";
import { acquireStartupLock, releaseStartupLock } from "../src/runtime-state/startup-lock";

const NodeFsPathLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
const ServerProbeUnreachable = Layer.succeed(ServerProbe)({
  isAlive: () => Effect.succeed(false),
});
const ServerProbeReachable = Layer.succeed(ServerProbe)({
  isAlive: () => Effect.succeed(true),
});
const NodeFsPathControlLayer = Layer.mergeAll(NodeFsPathLayer, ServerProbeUnreachable);
const fixedStartedAt = new Date("2026-06-16T00:00:00.000Z");
const fixedClock = {
  now: () => fixedStartedAt,
};
const fixedSessionId = "test-session";

const findDeadPid = (): number => {
  let candidate = 9_999_999;
  while (isPidAlive(candidate)) {
    candidate = candidate - 1;
  }
  return candidate;
};

const makeManifest = (input: {
  readonly pid: number;
  readonly configPath: string;
  readonly stateDir: string;
  readonly scopeId: string;
  readonly socketPath: string;
  readonly sessionId?: string;
}): ServerManifest =>
  ServerManifest.make({
    version: SERVER_MANIFEST_VERSION,
    protocolVersion: API_VERSION,
    pid: input.pid,
    sessionId: input.sessionId ?? fixedSessionId,
    startedAt: fixedStartedAt.toISOString(),
    configPath: input.configPath,
    stateDir: input.stateDir,
    scopeId: input.scopeId,
    endpoint: ManifestEndpoint.make({ kind: "unix-socket", path: input.socketPath }),
    owner: ServerOwnerMetadata.make({
      client: "test",
      version: "0.0.0",
      executablePath: process.execPath,
    }),
  });

const makeRuntimePaths = (
  pathService: Path.Path,
  root: string,
  overrides: Partial<Pick<ServerRuntimePaths, "manifestPath" | "startupLockPath">> & {
    readonly socketPath?: string;
  } = {},
): ServerRuntimePaths => {
  const configPath = pathService.join(root, "config.jsonc");
  const stateDir = pathService.join(root, "state");
  const scopeId = createScopeId({ configPath, stateDir });

  return {
    configPath,
    stateDir,
    runtimeDir: pathService.join(root, "runtime"),
    logDir: pathService.join(root, "logs"),
    dbPath: pathService.join(root, "state", "server.db"),
    manifestPath: overrides.manifestPath ?? pathService.join(root, "server.json"),
    startupLockPath: overrides.startupLockPath ?? pathService.join(root, "startup.lock"),
    controlEndpoint: {
      kind: "unix-socket",
      path: overrides.socketPath ?? pathService.join(root, "server.sock"),
    },
    scopeId,
  };
};

describe("runtime paths", () => {
  layer(NodePath.layer)((it) => {
    it.effect("resolves stable path-safe scope ids", () =>
      Effect.gen(function* () {
        const paths = yield* resolveRuntimePaths(
          normalizeServerOptions({ configPath: "/tmp/xmux-test/config.jsonc" }),
        );
        const again = yield* resolveRuntimePaths(
          normalizeServerOptions({ configPath: "/tmp/xmux-test/config.jsonc" }),
        );

        assert.strictEqual(paths.scopeId, again.scopeId);
        assert.strictEqual(paths.scopeId, createScopeId(paths));
        assert.match(paths.scopeId, /^[a-f0-9]{16}$/);
        assert.include(paths.manifestPath, paths.scopeId);
        assert.include(paths.startupLockPath, paths.scopeId);
        assert.include(paths.controlEndpoint.path, paths.scopeId);
      }),
    );
  });
});

describe("manifest state", () => {
  layer(NodeFsPathControlLayer)((it) => {
    it.effect("round-trips a manifest in a temp directory", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const pathService = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "server-manifest-" });
        const paths = makeRuntimePaths(pathService, root, {
          manifestPath: pathService.join(root, "server.json"),
        });
        const manifest = createServerManifest({
          paths,
          startedAt: fixedStartedAt,
          sessionId: fixedSessionId,
        });
        yield* writeServerManifest(paths.manifestPath, manifest);
        const read = yield* readServerManifest(paths.manifestPath);

        assert.strictEqual(read?.pid, process.pid);
        assert.strictEqual(read?.sessionId, fixedSessionId);
        assert.strictEqual(read?.scopeId, paths.scopeId);
        assert.strictEqual(read?.endpoint.path, manifest.endpoint.path);
        assert.strictEqual(read?.owner.version, SERVER_PACKAGE_VERSION);
      }),
    );

    it.effect("returns null for invalid manifest data", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const pathService = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "server-manifest-invalid-" });
        const manifestPath = pathService.join(root, "server.json");

        yield* fs.writeFileString(manifestPath, "not json");
        const manifest = yield* readServerManifest(manifestPath);

        assert.isNull(manifest);
      }),
    );

    it.effect("does not treat PID liveness as manifest validity", () =>
      Effect.sync(() => {
        const deadPid = findDeadPid();
        const raw = serializeServerManifest(
          makeManifest({
            pid: deadPid,
            configPath: "/tmp/config.jsonc",
            stateDir: "/tmp/state",
            scopeId: "abc123",
            socketPath: "/tmp/server.sock",
          }),
        );

        assert.strictEqual(parseServerManifest(raw)?.pid, deadPid);
      }),
    );

    it.effect("removes unreachable manifests without trusting PID liveness", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const pathService = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "server-manifest-active-" });
        const manifestPath = pathService.join(root, "server.json");
        const paths = makeRuntimePaths(pathService, root, { manifestPath });
        const staleManifest = makeManifest({
          pid: process.pid,
          configPath: paths.configPath,
          stateDir: paths.stateDir,
          scopeId: paths.scopeId,
          socketPath: pathService.join(root, "missing.sock"),
        });

        yield* writeServerManifest(manifestPath, staleManifest);
        yield* assertNoActiveServer(paths);

        assert.isFalse(yield* fs.exists(manifestPath));
      }),
    );

    it.effect("fails startup when a manifest endpoint is reachable", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const pathService = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "server-manifest-reachable-" });
        const manifestPath = pathService.join(root, "server.json");
        const socketPath = pathService.join(root, "server.sock");
        const paths = makeRuntimePaths(pathService, root, { manifestPath, socketPath });
        const activeManifest = makeManifest({
          pid: process.pid,
          configPath: paths.configPath,
          stateDir: paths.stateDir,
          scopeId: paths.scopeId,
          socketPath,
        });

        yield* writeServerManifest(manifestPath, activeManifest);
        const error = yield* assertNoActiveServer(paths).pipe(
          Effect.provide(ServerProbeReachable),
          Effect.flip,
        );

        if (error._tag !== "ActiveServerError") {
          assert.fail(`Expected ActiveServerError, got ${error._tag}`);
          return;
        }
        assert.strictEqual(error.endpointPath, socketPath);
        assert.isTrue(yield* fs.exists(manifestPath));
      }),
    );

    it.effect("does not remove another PID's manifest", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const pathService = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "server-manifest-owned-" });
        const manifestPath = pathService.join(root, "server.json");
        const otherManifest = makeManifest({
          pid: findDeadPid(),
          configPath: pathService.join(root, "config.jsonc"),
          stateDir: pathService.join(root, "state"),
          scopeId: "otherpid",
          socketPath: pathService.join(root, "server.sock"),
        });

        yield* writeServerManifest(manifestPath, otherManifest);
        yield* removeServerManifestIfOwnedBy({
          manifestPath,
          pid: process.pid,
          sessionId: fixedSessionId,
        });

        assert.isTrue(yield* fs.exists(manifestPath));
      }),
    );

    it.effect("does not remove another session for the same PID", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const pathService = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "server-manifest-session-" });
        const manifestPath = pathService.join(root, "server.json");
        const otherSessionManifest = makeManifest({
          pid: process.pid,
          configPath: pathService.join(root, "config.jsonc"),
          stateDir: pathService.join(root, "state"),
          scopeId: "samepid",
          socketPath: pathService.join(root, "server.sock"),
          sessionId: "other-session",
        });

        yield* writeServerManifest(manifestPath, otherSessionManifest);
        yield* removeServerManifestIfOwnedBy({
          manifestPath,
          pid: process.pid,
          sessionId: fixedSessionId,
        });

        assert.isTrue(yield* fs.exists(manifestPath));
      }),
    );

    it.effect("removes only the scoped owned manifest on release", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const pathService = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "server-manifest-scope-" });
        const manifestPath = pathService.join(root, "server.json");
        const paths = makeRuntimePaths(pathService, root, { manifestPath });

        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* acquireManifestOwnership({
              paths,
              startedAt: fixedStartedAt,
              sessionId: fixedSessionId,
            });
            assert.isTrue(yield* fs.exists(manifestPath));
          }),
        );

        assert.isFalse(yield* fs.exists(manifestPath));
      }),
    );
  });
});

describe("startup lock", () => {
  layer(NodeFsPathLayer)((it) => {
    it.effect("blocks a second acquire", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const pathService = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "server-lock-blocks-" });
        const startupLockPath = pathService.join(root, "startup.lock");

        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* acquireStartupLock({ startupLockPath });
            const error = yield* acquireStartupLock({ startupLockPath }).pipe(Effect.flip);
            assert.strictEqual(error._tag, "StartupLockError");
            assert.include(error.message, "already in progress");
          }),
        );

        assert.isFalse(yield* fs.exists(startupLockPath));
      }),
    );

    it.effect("reclaims a stale PID lock", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const pathService = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "server-lock-stale-" });
        const startupLockPath = pathService.join(root, "startup.lock");
        yield* fs.writeFileString(
          startupLockPath,
          `${JSON.stringify(
            {
              pid: findDeadPid(),
              startedAt: fixedStartedAt.toISOString(),
              nonce: "stale",
            },
            null,
            2,
          )}\n`,
        );

        yield* Effect.scoped(
          Effect.gen(function* () {
            const lock = yield* acquireStartupLock({ startupLockPath });
            assert.notStrictEqual(lock.nonce, "stale");
          }),
        );

        assert.isFalse(yield* fs.exists(startupLockPath));
      }),
    );

    it.effect("does not release a lock with another nonce", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const pathService = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "server-lock-nonce-" });
        const startupLockPath = pathService.join(root, "startup.lock");

        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* acquireStartupLock({ startupLockPath });
            yield* releaseStartupLock({ path: startupLockPath, pid: process.pid, nonce: "other" });
            assert.isTrue(yield* fs.exists(startupLockPath));
          }),
        );
      }),
    );
  });
});
