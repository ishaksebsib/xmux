import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { Effect, Option } from "effect";
import { ControlDiscovery } from "../src/control/discovery";
import type { CliResolvedServerPaths } from "../src/domain/discovery";
import { parseServerTarget } from "../src/domain/input";

interface EnvSnapshot {
  readonly xdgConfigHome: string | undefined;
  readonly xdgStateHome: string | undefined;
  readonly xdgRuntimeDir: string | undefined;
}

const posixIt = process.platform === "win32" ? it.skip : it;

const restoreEnvVar = (name: string, value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
};

const withDiscoveryEnv = async <A>(root: string, run: () => Promise<A>): Promise<A> => {
  const snapshot: EnvSnapshot = {
    xdgConfigHome: process.env.XDG_CONFIG_HOME,
    xdgStateHome: process.env.XDG_STATE_HOME,
    xdgRuntimeDir: process.env.XDG_RUNTIME_DIR,
  };

  process.env.XDG_CONFIG_HOME = join(root, "xdg-config");
  process.env.XDG_STATE_HOME = join(root, "xdg-state");
  process.env.XDG_RUNTIME_DIR = join(root, "xdg-runtime");

  try {
    return await run();
  } finally {
    restoreEnvVar("XDG_CONFIG_HOME", snapshot.xdgConfigHome);
    restoreEnvVar("XDG_STATE_HOME", snapshot.xdgStateHome);
    restoreEnvVar("XDG_RUNTIME_DIR", snapshot.xdgRuntimeDir);
  }
};

const withTempDiscoveryEnv = async <A>(run: (root: string) => Promise<A>): Promise<A> => {
  const root = await mkdtemp(join(tmpdir(), "xmux-cli-discovery-"));
  try {
    return await withDiscoveryEnv(root, () => run(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

const resolvePaths = (configPath: string): Promise<CliResolvedServerPaths> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const target = yield* parseServerTarget(Option.some(configPath));
      const discovery = yield* ControlDiscovery;
      return yield* discovery.resolvePaths(target);
    }).pipe(Effect.provide(ControlDiscovery.layer)),
  );

const discoverServer = (configPath: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const target = yield* parseServerTarget(Option.some(configPath));
      const discovery = yield* ControlDiscovery;
      return yield* discovery.discover(target);
    }).pipe(Effect.provide(ControlDiscovery.layer)),
  );

const requireRunningFailure = (configPath: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const target = yield* parseServerTarget(Option.some(configPath));
      const discovery = yield* ControlDiscovery;
      return yield* Effect.flip(discovery.requireRunning(target));
    }).pipe(Effect.provide(ControlDiscovery.layer)),
  );

const readManifest = (configPath: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const target = yield* parseServerTarget(Option.some(configPath));
      const discovery = yield* ControlDiscovery;
      return yield* discovery.readManifest(target);
    }).pipe(Effect.provide(ControlDiscovery.layer)),
  );

const writeText = async (path: string, content: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
};

const writeServerManifest = async (
  paths: CliResolvedServerPaths,
  options: { readonly scopeId?: string; readonly sessionId?: string } = {},
): Promise<void> => {
  await writeText(
    paths.manifestPath,
    JSON.stringify({
      version: 1,
      protocolVersion: 1,
      pid: process.pid,
      sessionId: options.sessionId ?? "test-session",
      startedAt: "2026-06-16T00:00:00.000Z",
      configPath: paths.configPath,
      stateDir: paths.stateDir,
      scopeId: options.scopeId ?? paths.scopeId,
      endpoint: { kind: "unix-socket", path: paths.socketPath },
      owner: {
        client: "test",
        version: "0.0.0",
        executablePath: process.execPath,
      },
    }),
  );
};

const bindHealthServer = async (socketPath: string): Promise<Server> => {
  await mkdir(dirname(socketPath), { recursive: true });

  const server = createServer((request, response) => {
    if (request.url !== "/healthz") {
      response.statusCode = 404;
      response.end();
      return;
    }

    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ alive: true, ready: true, state: "ready" }));
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (cause: Error): void => {
      server.off("listening", onListening);
      reject(cause);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(socketPath);
  });

  return server;
};

const closeServer = async (server: Server, socketPath: string): Promise<void> => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(socketPath, { force: true });
};

describe.sequential("control discovery", () => {
  posixIt("classifies a missing manifest", async () => {
    await withTempDiscoveryEnv(async (root) => {
      const configPath = join(root, "config.jsonc");
      const manifest = await readManifest(configPath);
      const discovery = await discoverServer(configPath);
      const notRunning = await requireRunningFailure(configPath);

      expect(manifest._tag).toBe("NoManifest");
      expect(discovery._tag).toBe("Stopped");
      expect(notRunning._tag).toBe("CliServerNotRunning");
      expect(notRunning.reason).toBe("no-manifest");
    });
  });

  posixIt("classifies invalid manifests", async () => {
    await withTempDiscoveryEnv(async (root) => {
      const configPath = join(root, "config.jsonc");
      const paths = await resolvePaths(configPath);
      await writeText(paths.manifestPath, "not json");

      const manifest = await readManifest(configPath);
      const discovery = await discoverServer(configPath);
      const notRunning = await requireRunningFailure(configPath);

      expect(manifest._tag).toBe("InvalidManifest");
      expect(discovery._tag).toBe("InvalidManifest");
      expect(notRunning.reason).toBe("invalid-manifest");
    });
  });

  posixIt("classifies stale manifests and removes them", async () => {
    await withTempDiscoveryEnv(async (root) => {
      const configPath = join(root, "config.jsonc");
      const paths = await resolvePaths(configPath);
      await writeServerManifest(paths, { sessionId: "stale-session" });

      const discovery = await discoverServer(configPath);
      await writeServerManifest(paths, { sessionId: "stale-session-again" });
      const notRunning = await requireRunningFailure(configPath);
      const manifestAfter = await readManifest(configPath);

      expect(discovery._tag).toBe("StaleManifestCleaned");
      expect(notRunning.reason).toBe("stale-manifest-removed");
      expect(manifestAfter._tag).toBe("NoManifest");
    });
  });

  posixIt("classifies wrong-scope manifests", async () => {
    await withTempDiscoveryEnv(async (root) => {
      const configPath = join(root, "config.jsonc");
      const paths = await resolvePaths(configPath);
      await writeServerManifest(paths, { scopeId: "wrong-scope" });

      const discovery = await discoverServer(configPath);
      const notRunning = await requireRunningFailure(configPath);

      expect(discovery._tag).toBe("WrongScope");
      expect(notRunning.reason).toBe("wrong-scope");
    });
  });

  posixIt("classifies running servers", async () => {
    await withTempDiscoveryEnv(async (root) => {
      const configPath = join(root, "config.jsonc");
      const paths = await resolvePaths(configPath);
      const server = await bindHealthServer(paths.socketPath);
      try {
        await writeServerManifest(paths, { sessionId: "active-session" });

        const manifest = await readManifest(configPath);
        const discovery = await discoverServer(configPath);

        expect(manifest._tag).toBe("ValidManifest");
        if (manifest._tag === "ValidManifest") {
          expect(manifest.manifest.endpointPath).toBe(paths.socketPath);
        }
        expect(discovery._tag).toBe("Running");
        if (discovery._tag === "Running") {
          expect(discovery.socketPath).toBe(paths.socketPath);
          expect(discovery.sessionId).toBe("active-session");
        }
      } finally {
        await closeServer(server, paths.socketPath);
      }
    });
  });
});
