import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Scope } from "effect";
import {
  findXmuxServer,
  readXmuxServerManifest,
  resolveXmuxServerPaths,
} from "../src/platform/node";
import { API_VERSION, SERVER_MANIFEST_VERSION } from "../src/contracts/constants";
import { ServerControlEndpoint } from "../src/contracts/control";
import { ServerManifest, ServerOwnerMetadata } from "../src/contracts/manifest";
import {
  isoTimestampFromString,
  processIdFromNumber,
  scopeIdFromString,
  sessionIdFromString,
  unixSocketPathFromString,
} from "../src/contracts/primitives";
import { createServerManifest, serializeServerManifest } from "../src/server-control/manifest";

const posixOnly = process.platform === "win32" ? it.live.skip : it.live;

interface EnvSnapshot {
  readonly xdgConfigHome: string | undefined;
  readonly xdgStateHome: string | undefined;
  readonly xdgRuntimeDir: string | undefined;
}

const makeTempRoot = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "xmux-node-discovery-"))),
  (root) => Effect.promise(() => rm(root, { recursive: true, force: true })).pipe(Effect.ignore),
);

const restoreEnvVar = (name: string, value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
};

const withDiscoveryEnv = <A, E, R>(
  root: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync((): EnvSnapshot => {
      const snapshot = {
        xdgConfigHome: process.env.XDG_CONFIG_HOME,
        xdgStateHome: process.env.XDG_STATE_HOME,
        xdgRuntimeDir: process.env.XDG_RUNTIME_DIR,
      };
      process.env.XDG_CONFIG_HOME = join(root, "xdg-config");
      process.env.XDG_STATE_HOME = join(root, "xdg-state");
      process.env.XDG_RUNTIME_DIR = join(root, "xdg-runtime");
      return snapshot;
    }),
    () => effect,
    (snapshot) =>
      Effect.sync(() => {
        restoreEnvVar("XDG_CONFIG_HOME", snapshot.xdgConfigHome);
        restoreEnvVar("XDG_STATE_HOME", snapshot.xdgStateHome);
        restoreEnvVar("XDG_RUNTIME_DIR", snapshot.xdgRuntimeDir);
      }),
  );

const writeText = (path: string, content: string): Effect.Effect<void> =>
  Effect.promise(async () => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  });

const bindHealthServer = (socketPath: string): Effect.Effect<Server, Error, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.callback<Server, Error>((resume) => {
      const server = createServer((request, response) => {
        if (request.url !== "/healthz") {
          response.statusCode = 404;
          response.end();
          return;
        }

        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ alive: true, ready: true, state: "ready" }));
      });
      const onError = (cause: Error): void => {
        resume(Effect.fail(cause));
      };

      server.once("error", onError);
      server.listen(socketPath, () => {
        server.off("error", onError);
        resume(Effect.succeed(server));
      });

      return Effect.sync(() => {
        server.close();
      });
    }),
    (server) =>
      Effect.callback<void>((resume) => {
        server.close(() => resume(Effect.void));
      }).pipe(
        Effect.flatMap(() => Effect.promise(() => rm(socketPath, { force: true }))),
        Effect.ignore,
      ),
  );

describe("public Node server discovery", () => {
  posixOnly("reports no manifest without crashing", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* makeTempRoot;
        yield* withDiscoveryEnv(
          root,
          Effect.gen(function* () {
            const configPath = join(root, "config.jsonc");
            const manifest = yield* readXmuxServerManifest({ configPath });
            const active = yield* findXmuxServer({ configPath });

            assert.strictEqual(manifest._tag, "NoManifest");
            assert.strictEqual(active._tag, "Stopped");
            if (active._tag === "Stopped") {
              assert.strictEqual(active.reason, "no-manifest");
            }
          }),
        );
      }),
    ),
  );

  posixOnly("finds a valid active manifest by probing the socket", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* makeTempRoot;
        yield* withDiscoveryEnv(
          root,
          Effect.gen(function* () {
            const configPath = join(root, "config.jsonc");
            const paths = yield* resolveXmuxServerPaths({ configPath });
            yield* Effect.promise(() =>
              mkdir(dirname(paths.controlEndpoint.path), { recursive: true }),
            );
            yield* bindHealthServer(paths.controlEndpoint.path);
            const manifest = createServerManifest({
              paths,
              startedAt: new Date("2026-06-16T00:00:00.000Z"),
              sessionId: sessionIdFromString("active-session"),
              pid: processIdFromNumber(process.pid),
              executablePath: process.execPath,
            });
            yield* writeText(paths.manifestPath, serializeServerManifest(manifest));

            const active = yield* findXmuxServer({ configPath });

            assert.strictEqual(active._tag, "Running");
            if (active._tag === "Running") {
              assert.strictEqual(active.active.endpointPath, paths.controlEndpoint.path);
              assert.strictEqual(active.active.pid, process.pid);
            }
          }),
        );
      }),
    ),
  );

  posixOnly("classifies invalid manifests without throwing", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* makeTempRoot;
        yield* withDiscoveryEnv(
          root,
          Effect.gen(function* () {
            const configPath = join(root, "config.jsonc");
            const paths = yield* resolveXmuxServerPaths({ configPath });
            yield* writeText(paths.manifestPath, "not json");

            const manifest = yield* readXmuxServerManifest({ configPath });
            const active = yield* findXmuxServer({ configPath });

            assert.strictEqual(manifest._tag, "InvalidManifest");
            assert.strictEqual(active._tag, "Stopped");
            if (active._tag === "Stopped") {
              assert.strictEqual(active.reason, "invalid-manifest");
            }
          }),
        );
      }),
    ),
  );

  posixOnly("removes stale unreachable manifests", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* makeTempRoot;
        yield* withDiscoveryEnv(
          root,
          Effect.gen(function* () {
            const configPath = join(root, "config.jsonc");
            const paths = yield* resolveXmuxServerPaths({ configPath });
            const manifest = createServerManifest({
              paths,
              startedAt: new Date("2026-06-16T00:00:00.000Z"),
              sessionId: sessionIdFromString("stale-session"),
              pid: processIdFromNumber(process.pid),
              executablePath: process.execPath,
            });
            yield* writeText(paths.manifestPath, serializeServerManifest(manifest));

            const active = yield* findXmuxServer({ configPath });

            assert.strictEqual(active._tag, "Stopped");
            if (active._tag === "Stopped") {
              assert.strictEqual(active.reason, "stale-manifest-removed");
            }
            const after = yield* readXmuxServerManifest({ configPath });
            assert.strictEqual(after._tag, "NoManifest");
          }),
        );
      }),
    ),
  );

  posixOnly("does not treat a wrong-scope manifest as active", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* makeTempRoot;
        yield* withDiscoveryEnv(
          root,
          Effect.gen(function* () {
            const configPath = join(root, "config.jsonc");
            const paths = yield* resolveXmuxServerPaths({ configPath });
            const wrongScopeManifest = ServerManifest.make({
              version: SERVER_MANIFEST_VERSION,
              protocolVersion: API_VERSION,
              pid: processIdFromNumber(process.pid),
              sessionId: sessionIdFromString("wrong-scope-session"),
              startedAt: isoTimestampFromString("2026-06-16T00:00:00.000Z"),
              configPath: paths.configPath,
              stateDir: paths.stateDir,
              scopeId: scopeIdFromString("wrong-scope"),
              endpoint: ServerControlEndpoint.make({
                kind: "unix-socket",
                path: unixSocketPathFromString(paths.controlEndpoint.path),
              }),
              owner: ServerOwnerMetadata.make({
                client: "test",
                version: "0.0.0",
                executablePath: process.execPath,
              }),
            });
            yield* writeText(paths.manifestPath, serializeServerManifest(wrongScopeManifest));

            const active = yield* findXmuxServer({ configPath });

            assert.strictEqual(active._tag, "Stopped");
            if (active._tag === "Stopped") {
              assert.strictEqual(active.reason, "wrong-scope");
            }
          }),
        );
      }),
    ),
  );
});
