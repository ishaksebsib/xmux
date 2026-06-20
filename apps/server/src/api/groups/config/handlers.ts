import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { ServerConfig } from "../../../config/service";
import { API_VERSION } from "../../../contracts/constants";
import { serverApi } from "../../api";
import { apiError } from "../../shared/errors";
import { ConfigValidateResponse, EffectiveConfigResponse } from "./schemas";

export const effective = Effect.fn("api.config.effective")(function* () {
  const config = yield* ServerConfig;

  return yield* config.getRedacted.pipe(
    Effect.matchEffect({
      onFailure: (error) =>
        Effect.fail(
          apiError({
            status: 500,
            code: "config_unavailable",
            message: error.message,
          }),
        ),
      onSuccess: (snapshot) =>
        Effect.succeed(
          EffectiveConfigResponse.make({
            version: API_VERSION,
            configPath: snapshot.configPath,
            config: snapshot.config,
          }),
        ),
    }),
  );
});

export const validate = Effect.fn("api.config.validate")(function* () {
  const config = yield* ServerConfig;
  const result = yield* config.validateCurrent;
  if (!result.valid) {
    return yield* Effect.fail(
      ConfigValidateResponse.make({
        version: API_VERSION,
        configPath: result.configPath,
        valid: false,
        issues: result.issues,
      }),
    );
  }

  return ConfigValidateResponse.make({
    version: API_VERSION,
    configPath: result.configPath,
    valid: true,
    issues: result.issues,
    config: result.config,
  });
});

export const configHandlers = HttpApiBuilder.group(serverApi, "config", (handlers) =>
  handlers.handle("effective", () => effective()).handle("validate", () => validate()),
);
