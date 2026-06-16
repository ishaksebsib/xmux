import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it, layer } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";
import {
  CONTROL_PROTOCOL_VERSION,
  ManifestEndpoint,
  SERVER_MANIFEST_VERSION,
  ServerManifest,
  ServerOwnerMetadata,
} from "../src/contracts/manifest";
import { normalizeServerOptions } from "../src/options";
import {
  acquireManifestOwnership,
  createServerManifest,
  parseServerManifest,
  readServerManifest,
  removeServerManifestIfOwnedBy,
  serializeServerManifest,
  writeServerManifest,
} from "../src/runtime-state/manifest";
import { createScopeId, resolveRuntimePaths } from "../src/runtime-state/paths";
import { isPidAlive } from "../src/runtime-state/pid";
import { acquireStartupLock, releaseStartupLock } from "../src/runtime-state/startup-lock";

const NodeFsPathLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
const fixedStartedAt = new Date("2026-06-16T00:00:00.000Z");
const fixedClock = {
  now: () => fixedStartedAt,
};

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
}): ServerManifest =>
  new ServerManifest({
    version: SERVER_MANIFEST_VERSION,
    protocolVersion: CONTROL_PROTOCOL_VERSION,
    pid: input.pid,
    startedAt: fixedStartedAt.toISOString(),
    configPath: input.configPath,
    stateDir: input.stateDir,
    scopeId: input.scopeId,
    endpoint: new ManifestEndpoint({ kind: "unix-socket", path: input.socketPath }),
    owner: new ServerOwnerMetadata({
      client: "test",
      version: "0.0.0",
      executablePath: process.execPath,
    }),
  });

describe("runtime paths", () => {
  layer(NodePath.layer)((it) => {
    it.effect("resolves stable path-safe scope ids", () =>
      Effect.gen(function* () {
        const paths = yield* resolveRuntimePaths(
          normalizeServerOptions({
            configPath: "/tmp/xmux-test/config.jsonc",
            pathOverrides: {
              stateDir: "/tmp/xmux-test/state",
              runtimeDir: "/tmp/xmux-test/runtime",
            },
          }),
        );
        const again = yield* resolveRuntimePaths(
          normalizeServerOptions({
            configPath: "/tmp/xmux-test/config.jsonc",
            pathOverrides: {
              stateDir: "/tmp/xmux-test/state",
              runtimeDir: "/tmp/xmux-test/runtime",
            },
          }),
        );

        assert.strictEqual(paths.scopeId, again.scopeId);
        assert.strictEqual(paths.scopeId, createScopeId(paths));
        assert.match(paths.scopeId, /^[a-f0-9]{16}$/);
        assert.include(paths.manifestPath, paths.scopeId);
        assert.include(paths.startupLockPath, paths.scopeId);
        if (paths.controlEndpoint.kind !== "unix-socket") {
          assert.fail("default endpoint should be a Unix socket");
          return;
        }
        assert.include(paths.controlEndpoint.path, paths.scopeId);
      }),
    );
  });
});

describe("manifest state", () => {
  layer(NodeFsPathLayer)((it) => {
    it.effect("round-trips a manifest in a temp directory", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const pathService = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "server-manifest-" });
        const paths = yield* resolveRuntimePaths(
          normalizeServerOptions({
            configPath: pathService.join(root, "config.jsonc"),
            pathOverrides: {
              stateDir: pathService.join(root, "state"),
              runtimeDir: pathService.join(root, "runtime"),
              manifestPath: pathService.join(root, "server.json"),
            },
          }),
        );
        const manifest = createServerManifest({ paths, startedAt: fixedStartedAt });
        if (manifest === null) {
          assert.fail("expected a manifest for a Unix socket endpoint");
          return;
        }

        yield* writeServerManifest(paths.manifestPath, manifest);
        const read = yield* readServerManifest(paths.manifestPath);

        assert.strictEqual(read?.pid, process.pid);
        assert.strictEqual(read?.scopeId, paths.scopeId);
        assert.strictEqual(read?.endpoint.path, manifest.endpoint.path);
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

    it.effect("returns null for stale manifest data", () =>
      Effect.gen(function* () {
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

        assert.isNull(parseServerManifest(raw));
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
        yield* removeServerManifestIfOwnedBy({ manifestPath, pid: process.pid });

        assert.isTrue(yield* fs.exists(manifestPath));
      }),
    );

    it.effect("removes only the scoped owned manifest on release", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const pathService = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "server-manifest-scope-" });
        const manifestPath = pathService.join(root, "server.json");
        const paths = yield* resolveRuntimePaths(
          normalizeServerOptions({
            configPath: pathService.join(root, "config.jsonc"),
            pathOverrides: {
              stateDir: pathService.join(root, "state"),
              runtimeDir: pathService.join(root, "runtime"),
              manifestPath,
            },
          }),
        );

        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* acquireManifestOwnership({ paths, startedAt: fixedStartedAt });
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
            yield* acquireStartupLock({ startupLockPath, clock: fixedClock, nonce: "first" });
            const error = yield* acquireStartupLock({
              startupLockPath,
              clock: fixedClock,
              nonce: "second",
            }).pipe(Effect.flip);
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
            const lock = yield* acquireStartupLock({
              startupLockPath,
              clock: fixedClock,
              nonce: "fresh",
            });
            assert.strictEqual(lock.nonce, "fresh");
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
            yield* acquireStartupLock({ startupLockPath, clock: fixedClock, nonce: "owner" });
            yield* releaseStartupLock({ path: startupLockPath, pid: process.pid, nonce: "other" });
            assert.isTrue(yield* fs.exists(startupLockPath));
          }),
        );
      }),
    );
  });
});
