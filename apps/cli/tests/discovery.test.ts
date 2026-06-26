import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Scope } from "effect";
import { cliRuntimeEnvForRoot, withEnvVars } from "./support/env";
import { makeCliSandbox, writeText } from "./support/sandbox";
import {
  bindHealthServer,
  discoverServer,
  readManifest,
  requireRunningFailure,
  resolvePaths,
  writeServerManifest,
} from "./support/discovery";

const posixIt = process.platform === "win32" ? it.live.skip : it.live;

const withSandboxDiscovery = <A, E, R>(
  run: (input: { readonly root: string; readonly configPath: string }) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | Scope.Scope> =>
  Effect.gen(function* () {
    const sandbox = yield* makeCliSandbox;
    const configPath = join(sandbox.root, "config.jsonc");
    return yield* withEnvVars(
      cliRuntimeEnvForRoot(sandbox.root),
      run({ root: sandbox.root, configPath }),
    );
  });

describe.sequential("control discovery", () => {
  posixIt("classifies a missing manifest", () =>
    withSandboxDiscovery(({ configPath }) =>
      Effect.gen(function* () {
        const manifest = yield* readManifest(configPath);
        const discovery = yield* discoverServer(configPath);
        const notRunning = yield* requireRunningFailure(configPath);

        expect(manifest._tag).toBe("NoManifest");
        expect(discovery._tag).toBe("Stopped");
        expect(notRunning._tag).toBe("CliServerNotRunning");
        expect(notRunning.reason).toBe("no-manifest");
      }),
    ),
  );

  posixIt("classifies invalid manifests", () =>
    withSandboxDiscovery(({ configPath }) =>
      Effect.gen(function* () {
        const paths = yield* resolvePaths(configPath);
        yield* writeText(paths.manifestPath, "not json");

        const manifest = yield* readManifest(configPath);
        const discovery = yield* discoverServer(configPath);
        const notRunning = yield* requireRunningFailure(configPath);

        expect(manifest._tag).toBe("InvalidManifest");
        expect(discovery._tag).toBe("InvalidManifest");
        expect(notRunning.reason).toBe("invalid-manifest");
      }),
    ),
  );

  posixIt("classifies stale manifests and removes them", () =>
    withSandboxDiscovery(({ configPath }) =>
      Effect.gen(function* () {
        const paths = yield* resolvePaths(configPath);
        yield* writeServerManifest(paths, { sessionId: "stale-session" });

        const discovery = yield* discoverServer(configPath);
        yield* writeServerManifest(paths, { sessionId: "stale-session-again" });
        const notRunning = yield* requireRunningFailure(configPath);
        const manifestAfter = yield* readManifest(configPath);

        expect(discovery._tag).toBe("StaleManifestCleaned");
        expect(notRunning.reason).toBe("stale-manifest-removed");
        expect(manifestAfter._tag).toBe("NoManifest");
      }),
    ),
  );

  posixIt("classifies wrong-scope manifests", () =>
    withSandboxDiscovery(({ configPath }) =>
      Effect.gen(function* () {
        const paths = yield* resolvePaths(configPath);
        yield* writeServerManifest(paths, { scopeId: "wrong-scope" });

        const discovery = yield* discoverServer(configPath);
        const notRunning = yield* requireRunningFailure(configPath);

        expect(discovery._tag).toBe("WrongScope");
        expect(notRunning.reason).toBe("wrong-scope");
      }),
    ),
  );

  posixIt("classifies running servers", () =>
    withSandboxDiscovery(({ configPath }) =>
      Effect.gen(function* () {
        const paths = yield* resolvePaths(configPath);
        yield* bindHealthServer(paths.socketPath);
        yield* writeServerManifest(paths, { sessionId: "active-session" });

        const manifest = yield* readManifest(configPath);
        const discovery = yield* discoverServer(configPath);

        expect(manifest._tag).toBe("ValidManifest");
        if (manifest._tag === "ValidManifest") {
          expect(manifest.manifest.endpointPath).toBe(paths.socketPath);
        }
        expect(discovery._tag).toBe("Running");
        if (discovery._tag === "Running") {
          expect(discovery.socketPath).toBe(paths.socketPath);
          expect(discovery.sessionId).toBe("active-session");
        }
      }),
    ),
  );
});
