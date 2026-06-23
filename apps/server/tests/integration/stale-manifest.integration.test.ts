import { readFile, writeFile } from "node:fs/promises";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { ServerControlEndpoint } from "../../src/contracts/control";
import { ServerManifest, ServerOwnerMetadata } from "../../src/contracts/manifest";
import { API_VERSION, SERVER_MANIFEST_VERSION } from "../../src/contracts/constants";
import {
  isoTimestampFromString,
  processIdFromNumber,
  sessionIdFromString,
} from "../../src/contracts/primitives";
import { serializeServerManifest } from "../../src/server-control/manifest";
import { serverMain } from "../../src/server";
import { assertRuntimeFilesCleaned, assertServerPublished } from "../support/assertions";
import { minimalConfig } from "../support/config";
import { makeInProcessServerLayer } from "../support/in-process-server";
import { makeSandbox } from "../support/sandbox";
import { waitForHealthReady } from "../support/wait";

const posixOnly = process.platform === "win32" ? it.live.skip : it.live;
const describeIntegration = process.env.RUN_INTEGRATION === "true" ? describe : describe.skip;

describeIntegration("stale manifest integration", () => {
  posixOnly(
    "removes an unreachable same-scope manifest and publishes the new running server",
    () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox;
        yield* sandbox.writeConfig(minimalConfig());

        const staleManifest = ServerManifest.make({
          version: SERVER_MANIFEST_VERSION,
          protocolVersion: API_VERSION,
          pid: processIdFromNumber(1),
          sessionId: sessionIdFromString("stale-session"),
          startedAt: isoTimestampFromString("2026-06-16T00:00:00.000Z"),
          configPath: sandbox.paths.configPath,
          stateDir: sandbox.paths.stateDir,
          scopeId: sandbox.paths.scopeId,
          endpoint: ServerControlEndpoint.make({
            kind: "unix-socket",
            path: sandbox.paths.controlEndpoint.path,
          }),
          owner: ServerOwnerMetadata.make({
            client: "server",
            version: "stale-version",
            executablePath: "/stale/xmux-server",
          }),
        });
        yield* Effect.promise(() =>
          writeFile(sandbox.paths.manifestPath, serializeServerManifest(staleManifest)),
        );

        yield* Effect.scoped(
          serverMain().pipe(
            Effect.provide(makeInProcessServerLayer({ paths: sandbox.paths })),
            Effect.forkScoped,
            Effect.flatMap((fiber) =>
              Effect.gen(function* () {
                const health = yield* waitForHealthReady(sandbox.paths.controlEndpoint.path);
                yield* assertServerPublished(sandbox.paths);
                assert.isTrue(health.ready);

                const manifestText = yield* Effect.promise(() =>
                  readFile(sandbox.paths.manifestPath, "utf8"),
                );
                assert.notInclude(manifestText, "stale-session");
                assert.notInclude(manifestText, "stale-version");
                assert.include(manifestText, sandbox.paths.controlEndpoint.path);

                yield* Fiber.interrupt(fiber);
              }),
            ),
          ),
        );

        yield* assertRuntimeFilesCleaned(sandbox.paths);
      }),
    15_000,
  );
});
