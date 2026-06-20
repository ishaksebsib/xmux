import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { serverMain } from "../../src/server";
import { assertRuntimeFilesCleaned } from "../support/assertions";
import {
  invalidJsonConfig,
  invalidLogLevelConfig,
  missingEnvSecretConfig,
} from "../support/config";
import { makeInProcessServerLayer } from "../support/in-process-server";
import { makeSandbox } from "../support/sandbox";

const posixOnly = process.platform === "win32" ? it.live.skip : it.live;
const describeIntegration = process.env.RUN_INTEGRATION === "true" ? describe : describe.skip;

const assertStartupFailure = (config: string, tag: string) =>
  Effect.gen(function* () {
    const sandbox = yield* makeSandbox;
    yield* sandbox.writeConfig(config);
    const error = yield* Effect.scoped(serverMain()).pipe(
      Effect.provide(makeInProcessServerLayer({ paths: sandbox.paths })),
      Effect.flip,
    );
    assert.strictEqual(error._tag, tag);
    yield* assertRuntimeFilesCleaned(sandbox.paths);
  });

describeIntegration("startup failure integration", () => {
  posixOnly("invalid JSONC fails without publishing runtime files", () =>
    assertStartupFailure(invalidJsonConfig, "ConfigParseError"),
  );

  posixOnly("schema mismatch fails without publishing runtime files", () =>
    assertStartupFailure(invalidLogLevelConfig, "ConfigValidationError"),
  );

  posixOnly("missing env secret fails without publishing runtime files", () =>
    assertStartupFailure(missingEnvSecretConfig("XMUX_MISSING_SECRET"), "ConfigSecretError"),
  );
});
