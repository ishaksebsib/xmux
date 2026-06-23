import { mkdir, writeFile } from "node:fs/promises";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { serverMain } from "../../src/server";
import { assertRuntimeFilesCleaned, assertServerPublished } from "../support/assertions";
import { tailLogs, requestRawUnixHttp } from "../support/client";
import { minimalConfig, missingEnvSecretConfig } from "../support/config";
import { makeInProcessServerLayer, withInProcessServer } from "../support/in-process-server";
import { makeSandbox } from "../support/sandbox";
import { withSubprocessServer } from "../support/subprocess-server";
import { waitForHealthReady } from "../support/wait";

const posixOnly = process.platform === "win32" ? it.live.skip : it.live;
const describeIntegration = process.env.RUN_INTEGRATION === "true" ? describe : describe.skip;

const staleStartupLock = JSON.stringify(
  { pid: 999_999_999, startedAt: "2026-06-16T00:00:00.000Z", nonce: "stale-lock" },
  null,
  2,
);

describeIntegration("startup runtime edge integration", () => {
  posixOnly(
    "removes a stale startup lock and starts normally",
    () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox;
        yield* sandbox.writeConfig(minimalConfig());
        yield* Effect.promise(() =>
          writeFile(sandbox.paths.startupLockPath, `${staleStartupLock}\n`),
        );

        yield* Effect.scoped(
          serverMain().pipe(
            Effect.provide(makeInProcessServerLayer({ paths: sandbox.paths })),
            Effect.forkScoped,
            Effect.flatMap((fiber) =>
              Effect.gen(function* () {
                const health = yield* waitForHealthReady(sandbox.paths.controlEndpoint.path);
                assert.isTrue(health.ready);
                yield* assertServerPublished(sandbox.paths);
                yield* Fiber.interrupt(fiber);
              }),
            ),
          ),
        );

        yield* assertRuntimeFilesCleaned(sandbox.paths);
      }),
    15_000,
  );

  posixOnly(
    "removes a stale socket path before binding",
    () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox;
        yield* sandbox.writeConfig(minimalConfig());
        yield* Effect.promise(() => mkdir(sandbox.paths.runtimeDir, { recursive: true }));
        yield* Effect.promise(() =>
          writeFile(sandbox.paths.controlEndpoint.path, "stale socket placeholder"),
        );

        yield* Effect.scoped(
          serverMain().pipe(
            Effect.provide(makeInProcessServerLayer({ paths: sandbox.paths })),
            Effect.forkScoped,
            Effect.flatMap((fiber) =>
              Effect.gen(function* () {
                const health = yield* waitForHealthReady(sandbox.paths.controlEndpoint.path);
                assert.isTrue(health.ready);
                yield* assertServerPublished(sandbox.paths);
                yield* Fiber.interrupt(fiber);
              }),
            ),
          ),
        );

        yield* assertRuntimeFilesCleaned(sandbox.paths);
      }),
    15_000,
  );

  posixOnly(
    "resolves env secrets in a real subprocess without leaking them to stdout, stderr, logs, or API",
    () =>
      withSubprocessServer(
        {
          config: missingEnvSecretConfig("XMUX_REAL_SECRET"),
          env: { XMUX_REAL_SECRET: "env-token-do-not-leak" },
        },
        ({ socketPath, output, shutdown }) =>
          Effect.gen(function* () {
            const logs = yield* tailLogs(socketPath, 20);
            assert.notInclude(JSON.stringify(logs), "env-token-do-not-leak");

            const rawLogs = yield* requestRawUnixHttp({
              socketPath,
              method: "GET",
              path: "/v1/logs",
            });
            assert.strictEqual(rawLogs.statusCode, 200);
            assert.notInclude(rawLogs.body, "env-token-do-not-leak");

            const captured = yield* output;
            assert.notInclude(captured.stdout, "env-token-do-not-leak");
            assert.notInclude(captured.stderr, "env-token-do-not-leak");

            yield* shutdown;
          }),
      ),
    15_000,
  );

  posixOnly(
    "enforces log tail query bounds over the real API",
    () =>
      withInProcessServer({ config: minimalConfig() }, ({ socketPath }) =>
        Effect.gen(function* () {
          const omitted = yield* tailLogs(socketPath);
          assert.isAtMost(omitted.entries.length, 200);

          const huge = yield* tailLogs(socketPath, 100_000);
          assert.isAtMost(huge.entries.length, 1_000);

          const zero = yield* requestRawUnixHttp({
            socketPath,
            method: "GET",
            path: "/v1/logs?tail=0",
          });
          assert.strictEqual(zero.statusCode, 400);

          const negative = yield* requestRawUnixHttp({
            socketPath,
            method: "GET",
            path: "/v1/logs?tail=-1",
          });
          assert.strictEqual(negative.statusCode, 400);
        }),
      ),
    15_000,
  );
});
