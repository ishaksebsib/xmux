import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { createXmuxClient } from "../../src/platform/node";
import { assertNoSecret, assertServerPublished } from "../support/assertions";
import {
  getEffectiveConfig,
  getHealth,
  getStatus,
  requestUnix,
  tailLogs,
  validateConfig,
} from "../support/client";
import { invalidLogLevelConfig, validTelegramConfig, writeConfig } from "../support/config";
import { withInProcessServer } from "../support/in-process-server";

const posixOnly = process.platform === "win32" ? it.live.skip : it.live;
const describeIntegration = process.env.RUN_INTEGRATION === "true" ? describe : describe.skip;
const secret = "inline-telegram-token-do-not-leak";

describeIntegration("control API integration", () => {
  posixOnly("serves all current control routes over a real Unix socket", () =>
    withInProcessServer({ config: validTelegramConfig(secret) }, ({ paths, socketPath }) =>
      Effect.gen(function* () {
        yield* assertServerPublished(paths);
        const health = yield* getHealth(socketPath);
        assert.isTrue(health.ready);
        const status = yield* getStatus(socketPath);
        assert.strictEqual(status.state, "ready");
        const configResponse = yield* requestUnix({
          socketPath,
          method: "GET",
          path: "/v1/config/effective",
        });
        assert.strictEqual(configResponse.statusCode, 200);
        yield* assertNoSecret(configResponse.body, secret);
        const config = yield* getEffectiveConfig(socketPath);
        assert.strictEqual(config.config.chats.telegram.token?.source, "value");
        const valid = yield* validateConfig(socketPath);
        assert.isTrue(valid.valid);
        yield* writeConfig(paths.configPath, invalidLogLevelConfig);
        const invalid = yield* requestUnix({
          socketPath,
          method: "POST",
          path: "/v1/config/validate",
        });
        assert.strictEqual(invalid.statusCode, 422);
        const logsResponse = yield* requestUnix({
          socketPath,
          method: "GET",
          path: "/v1/logs?tail=5",
        });
        assert.strictEqual(logsResponse.statusCode, 200);
        yield* assertNoSecret(logsResponse.body, secret);
        const logs = yield* tailLogs(socketPath, 5);
        assert.isAtMost(logs.entries.length, 5);
        const missing = yield* requestUnix({ socketPath, method: "GET", path: "/missing" });
        assert.strictEqual(missing.statusCode, 404);
        const wrongMethod = yield* requestUnix({ socketPath, method: "POST", path: "/healthz" });
        assert.isAtLeast(wrongMethod.statusCode, 400);
        const typedHealth = yield* Effect.scoped(
          Effect.gen(function* () {
            const client = yield* createXmuxClient({ socketPath });
            return yield* client.system.health();
          }),
        );
        assert.isTrue(typedHealth.alive);
      }),
    ),
  );
});
