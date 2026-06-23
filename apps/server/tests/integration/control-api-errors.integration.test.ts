import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { validTelegramConfig } from "../support/config";
import { requestRawUnixHttp } from "../support/client";
import { withInProcessServer } from "../support/in-process-server";

const posixOnly = process.platform === "win32" ? it.live.skip : it.live;
const describeIntegration = process.env.RUN_INTEGRATION === "true" ? describe : describe.skip;

describeIntegration("control API error integration", () => {
  posixOnly(
    "rejects invalid log tail query without leaking configured secrets",
    () =>
      withInProcessServer(
        { config: validTelegramConfig("control-error-token-do-not-leak") },
        ({ socketPath }) =>
          Effect.gen(function* () {
            const response = yield* requestRawUnixHttp({
              socketPath,
              method: "GET",
              path: "/v1/logs?tail=not-a-number",
            });

            assert.strictEqual(response.statusCode, 400);
            assert.notInclude(response.body, "control-error-token-do-not-leak");
          }),
      ),
    15_000,
  );
});
