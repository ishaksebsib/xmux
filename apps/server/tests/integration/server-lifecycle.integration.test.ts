import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { assertRuntimeFilesCleaned, assertServerPublished } from "../support/assertions";
import { getHealth, getStatus, tailLogs } from "../support/client";
import { minimalConfig } from "../support/config";
import { withSubprocessServer } from "../support/subprocess-server";

const posixOnly = process.platform === "win32" ? it.live.skip : it.live;
const describeIntegration = process.env.RUN_INTEGRATION === "true" ? describe : describe.skip;

describeIntegration("server lifecycle integration", () => {
  posixOnly(
    "starts, publishes control state, and shuts down cleanly",
    () =>
      withSubprocessServer(
        { config: minimalConfig() },
        ({ paths, socketPath, configPath, shutdown }) =>
          Effect.gen(function* () {
            yield* assertServerPublished(paths);
            const health = yield* getHealth(socketPath);
            assert.isTrue(health.ready);
            const status = yield* getStatus(socketPath);
            assert.strictEqual(status.state, "ready");
            assert.strictEqual(status.endpoint.path, socketPath);
            assert.strictEqual(status.configPath, configPath);
            assert.isAbove(status.pid, 0);
            const logs = yield* tailLogs(socketPath, 20);
            assert.isAtMost(logs.entries.length, 20);
            yield* shutdown;
            yield* assertRuntimeFilesCleaned(paths);
          }),
      ),
    30_000,
  );
});
