import { Context, Effect, FileSystem, Layer, Path, Ref } from "effect";
import {
  ConfigValidationIssue,
  type ConfigValidationResult,
  InvalidConfigValidationResult,
  RedactedConfigSnapshot,
} from "../contracts/config";
import { ConfigValidationError, type ConfigError } from "../errors";
import type { ConfigPath } from "../contracts/primitives";
import { HostRuntime } from "../platform/host";
import { RuntimePaths } from "../server-control/paths";
import type { EffectiveServerConfig } from "./effective";
import { loadEffectiveServerConfig, validateServerConfig } from "./normalize";
import { redactServerConfig } from "./redact";
import { SecretResolver } from "./resolve-secrets";

interface LoadedConfig {
  readonly configPath: ConfigPath;
  readonly effective: EffectiveServerConfig;
}

/** ServerConfig owns the currently loaded effective config for control routes. */
export class ServerConfig extends Context.Service<
  ServerConfig,
  {
    readonly loadCurrent: (configPath: ConfigPath) => Effect.Effect<EffectiveServerConfig, ConfigError>;
    readonly getEffective: () => Effect.Effect<EffectiveServerConfig, ConfigValidationError>;
    readonly getRedacted: () => Effect.Effect<RedactedConfigSnapshot, ConfigValidationError>;
    readonly validateCurrent: () => Effect.Effect<ConfigValidationResult>;
  }
>()("@xmux/server/ServerConfig") {
  /** Config layer captures platform dependencies once and exposes a testable API. */
  static readonly layer = Layer.effect(
    ServerConfig,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const pathService = yield* Path.Path;
      const host = yield* HostRuntime;
      const secretResolver = yield* SecretResolver;
      const runtimePaths = yield* RuntimePaths;
      const current = yield* Ref.make<LoadedConfig | null>(null);

      const withCapturedConfigDependencies = <A, E>(
        effect: Effect.Effect<
          A,
          E,
          FileSystem.FileSystem | Path.Path | HostRuntime | SecretResolver
        >,
      ): Effect.Effect<A, E> =>
        effect.pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, pathService),
          Effect.provideService(HostRuntime, host),
          Effect.provideService(SecretResolver, secretResolver),
        );

      const loadCurrent = Effect.fn("ServerConfig.loadCurrent")(function* (configPath: ConfigPath) {
        return yield* withCapturedConfigDependencies(
          loadEffectiveServerConfig(configPath).pipe(
            Effect.tap((effective) => Ref.set(current, { configPath, effective })),
          ),
        );
      });

      const getLoaded = Effect.fn("ServerConfig.getLoaded")(function* () {
        const loaded = yield* Ref.get(current);
        if (loaded !== null) return loaded;
        return yield* ConfigValidationError.make({
          path: runtimePaths.configPath,
          message: "Server config has not been loaded yet.",
        });
      });

      const getEffective = Effect.fn("ServerConfig.getEffective")(function* () {
        const loaded = yield* getLoaded();
        return loaded.effective;
      });

      const getRedacted = Effect.fn("ServerConfig.getRedacted")(function* () {
        const loaded = yield* getLoaded();
        return RedactedConfigSnapshot.make({
          configPath: loaded.configPath,
          config: redactServerConfig(loaded.effective),
        });
      });

      const validateCurrent = Effect.fn("ServerConfig.validateCurrent")(function* () {
        const loaded = yield* Ref.get(current);
        if (loaded === null) {
          return InvalidConfigValidationResult.make({
            configPath: runtimePaths.configPath,
            valid: false,
            issues: [
              ConfigValidationIssue.make({
                code: "ConfigValidationError",
                message: "Server config has not been loaded yet.",
              }),
            ],
          });
        }

        return yield* withCapturedConfigDependencies(validateServerConfig(loaded.configPath));
      });

      return { loadCurrent, getEffective, getRedacted, validateCurrent };
    }),
  );
}
