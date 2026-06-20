import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { serverMain } from "../../src/server";
import { getHealth } from "../support/client";
import { minimalConfig } from "../support/config";
import { makeInProcessServerLayer, withInProcessServer } from "../support/in-process-server";

const posixOnly = process.platform === "win32" ? it.live.skip : it.live;
const describeIntegration = process.env.RUN_INTEGRATION === "true" ? describe : describe.skip;

describeIntegration("duplicate server integration", () => {
  posixOnly("rejects a second server for the same scope while the first is healthy", () =>
    withInProcessServer({ config: minimalConfig() }, ({ paths, socketPath }) =>
      Effect.gen(function* () {
        const error = yield* Effect.scoped(serverMain()).pipe(
          Effect.provide(makeInProcessServerLayer({ paths })),
          Effect.flip,
        );
        assert.strictEqual(error._tag, "ActiveServerError");
        const health = yield* getHealth(socketPath);
        assert.isTrue(health.ready);
      }),
    ),
  );
});
