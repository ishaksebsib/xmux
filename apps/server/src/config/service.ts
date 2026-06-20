import { Context, Effect, FileSystem, Layer, Path, Ref } from "effect";
import {
  ConfigValidationIssue,
  type ConfigValidationResult,
  InvalidConfigValidationResult,
  RedactedConfigSnapshot,
} from "../contracts/config";
import { ConfigValidationError, type ConfigError } from "../errors";
import { HostRuntime } from "../platform/host";
import type { EffectiveServerConfig } from "./effective";
import { loadEffectiveServerConfig, validateServerConfig } from "./normalize";
import { redactServerConfig } from "./redact";
import { SecretResolver } from "./resolve-secrets";

interface LoadedConfig {
  readonly configPath: string;
  readonly effective: EffectiveServerConfig;
}

/** ServerConfig owns the currently loaded effective config for control routes. */
export class ServerConfig extends Context.Service<
  ServerConfig,
  {
    readonly loadCurrent: (configPath: string) => Effect.Effect<EffectiveServerConfig, ConfigError>;
    readonly getEffective: Effect.Effect<EffectiveServerConfig, ConfigValidationError>;
    readonly getRedacted: Effect.Effect<RedactedConfigSnapshot, ConfigValidationError>;
    readonly validateCurrent: Effect.Effect<ConfigValidationResult>;
  }
>()("@xmux/server/ServerConfig") {}

/** Config layer captures platform dependencies once and exposes a testable API. */
export const ServerConfigLayer = Layer.effect(ServerConfig)(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const host = yield* HostRuntime;
    const secretResolver = yield* SecretResolver;
    const current = yield* Ref.make<LoadedConfig | null>(null);

    const loadCurrent = (configPath: string): Effect.Effect<EffectiveServerConfig, ConfigError> =>
      loadEffectiveServerConfig(configPath).pipe(
        Effect.tap((effective) => Ref.set(current, { configPath, effective })),
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, pathService),
        Effect.provideService(HostRuntime, host),
        Effect.provideService(SecretResolver, secretResolver),
      );

    const getLoaded = Ref.get(current).pipe(
      Effect.flatMap((loaded) =>
        loaded === null
          ? ConfigValidationError.make({
              path: "",
              message: "Server config has not been loaded yet.",
            })
          : Effect.succeed(loaded),
      ),
    );

    return {
      loadCurrent,
      getEffective: getLoaded.pipe(Effect.map((loaded) => loaded.effective)),
      getRedacted: getLoaded.pipe(
        Effect.map((loaded) =>
          RedactedConfigSnapshot.make({
            configPath: loaded.configPath,
            config: redactServerConfig(loaded.effective),
          }),
        ),
      ),
      validateCurrent: Ref.get(current).pipe(
        Effect.flatMap((loaded) =>
          loaded === null
            ? Effect.succeed(
                InvalidConfigValidationResult.make({
                  configPath: "",
                  valid: false,
                  issues: [
                    ConfigValidationIssue.make({
                      code: "ConfigValidationError",
                      message: "Server config has not been loaded yet.",
                    }),
                  ],
                }),
              )
            : validateServerConfig(loaded.configPath),
        ),
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, pathService),
        Effect.provideService(HostRuntime, host),
        Effect.provideService(SecretResolver, secretResolver),
      ),
    };
  }),
);
