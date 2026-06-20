import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { ServerConfig } from "../../../config/service";
import { API_VERSION } from "../../../contracts/constants";
import { serverApi } from "../../api";
import { jsonError } from "../../shared/errors";
import { ConfigValidateResponse, EffectiveConfigResponse } from "./schemas";

export const effective = Effect.fn("api.config.effective")(function* () {
  const config = yield* ServerConfig;

  return yield* config.getRedacted.pipe(
    Effect.matchEffect({
      onFailure: (error) =>
        jsonError({
          status: 500,
          code: "config_unavailable",
          message: error.message,
        }).pipe(Effect.orDie),
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
  const response = ConfigValidateResponse.make({
    version: API_VERSION,
    configPath: result.configPath,
    valid: result.valid,
    issues: result.issues,
    ...(result.config === undefined ? {} : { config: result.config }),
  });
  if (!result.valid) return yield* Effect.fail(response);
  return response;
});

export const configHandlers = HttpApiBuilder.group(serverApi, "config", (handlers) =>
  handlers.handle("effective", () => effective()).handle("validate", () => validate()),
);
