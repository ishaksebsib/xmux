import { homedir } from "node:os";
import { Context, Effect, FileSystem, Layer, Path, Ref } from "effect";
import {
  ConfigValidateResponse,
  ConfigValidationIssue,
  DiscordModeConfig,
  type DiscordFileConfig,
  EffectiveConfigResponse,
  type OpenCodeFileConfig,
  type PiFileConfig,
  ServerFileConfig,
  TelegramModeConfig,
  type TelegramFileConfig,
  type ServerFileServerConfig,
} from "../contracts/config";
import { ConfigValidationError, type ConfigError } from "../errors";
import { CONTROL_RESPONSE_VERSION } from "../contracts/control";
import { loadServerConfigFile } from "./load-jsonc";
import { redactServerConfig } from "./redact";
import { resolveSecretRef, SecretResolver } from "./resolve-secrets";
import {
  EffectiveChatsConfig,
  EffectiveDiscordConfig,
  EffectiveHarnessesConfig,
  EffectiveOpenCodeConfig,
  EffectivePiConfig,
  EffectiveServerConfig,
  EffectiveServerSettings,
  EffectiveTelegramConfig,
} from "./schema";

interface LoadedConfig {
  readonly configPath: string;
  readonly effective: EffectiveServerConfig;
}

const defaultUserName = (): string => process.env.USER ?? process.env.USERNAME ?? "xmux";

const expandHome = (pathService: Path.Path, input: string): string => {
  if (input === "~") return homedir();
  if (input.startsWith("~/")) return pathService.join(homedir(), input.slice(2));
  return input;
};

const resolveConfigRelativePath = (
  pathService: Path.Path,
  configPath: string,
  input: string,
): string => {
  const expanded = expandHome(pathService, input);
  if (pathService.isAbsolute(expanded)) return pathService.resolve(expanded);
  return pathService.resolve(pathService.dirname(configPath), expanded);
};

const validationError = (input: {
  readonly configPath: string;
  readonly message: string;
}): ConfigValidationError =>
  ConfigValidationError.make({ path: input.configPath, message: input.message });

const normalizeServerSettings = (
  settings: ServerFileServerConfig | undefined,
): EffectiveServerSettings =>
  EffectiveServerSettings.make({
    logLevel: settings?.logLevel ?? "info",
  });

const normalizeTelegram = Effect.fn("server.normalizeTelegramConfig")(function* (input: {
  readonly configPath: string;
  readonly config: TelegramFileConfig | undefined;
}) {
  const enabled = input.config?.enabled ?? false;
  const mode = input.config?.mode ?? TelegramModeConfig.make({ type: "polling" });
  if (!enabled) return EffectiveTelegramConfig.make({ enabled, mode });

  if (input.config?.token === undefined) {
    return yield* validationError({
      configPath: input.configPath,
      message: "Telegram is enabled but chats.telegram.token is missing.",
    });
  }

  const token = yield* resolveSecretRef({ configPath: input.configPath, ref: input.config.token });
  return EffectiveTelegramConfig.make({ enabled, token, mode });
});

const normalizeDiscord = Effect.fn("server.normalizeDiscordConfig")(function* (input: {
  readonly configPath: string;
  readonly config: DiscordFileConfig | undefined;
}) {
  const enabled = input.config?.enabled ?? false;
  const mode = input.config?.mode ?? DiscordModeConfig.make({ type: "gateway" });
  const applicationId = input.config?.applicationId;
  const guildId = input.config?.guildId;
  const publicKey = input.config?.publicKey;

  if (!enabled) {
    return EffectiveDiscordConfig.make({
      enabled,
      mode,
      ...(applicationId === undefined ? {} : { applicationId }),
      ...(guildId === undefined ? {} : { guildId }),
      ...(publicKey === undefined ? {} : { publicKey }),
    });
  }

  if (input.config?.token === undefined) {
    return yield* validationError({
      configPath: input.configPath,
      message: "Discord is enabled but chats.discord.token is missing.",
    });
  }
  if (applicationId === undefined) {
    return yield* validationError({
      configPath: input.configPath,
      message: "Discord is enabled but chats.discord.applicationId is missing.",
    });
  }

  const token = yield* resolveSecretRef({ configPath: input.configPath, ref: input.config.token });
  return EffectiveDiscordConfig.make({
    enabled,
    token,
    applicationId,
    mode,
    ...(guildId === undefined ? {} : { guildId }),
    ...(publicKey === undefined ? {} : { publicKey }),
  });
});

const normalizeOpenCode = Effect.fn("server.normalizeOpenCodeConfig")(function* (input: {
  readonly configPath: string;
  readonly config: OpenCodeFileConfig | undefined;
}) {
  const mode = input.config?.mode ?? "embedded";
  if (mode === "external" && input.config?.baseUrl === undefined) {
    return yield* validationError({
      configPath: input.configPath,
      message: "OpenCode external mode requires harnesses.opencode.baseUrl.",
    });
  }

  const baseUrl = input.config?.baseUrl;
  const port = input.config?.port;
  const defaultModel = input.config?.defaultModel;
  const defaultThinking = input.config?.defaultThinking;

  return EffectiveOpenCodeConfig.make({
    enabled: input.config?.enabled ?? false,
    mode,
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(port === undefined ? {} : { port }),
    ...(defaultModel === undefined ? {} : { defaultModel }),
    ...(defaultThinking === undefined ? {} : { defaultThinking }),
  });
});

const normalizePi = (input: {
  readonly pathService: Path.Path;
  readonly configPath: string;
  readonly config: PiFileConfig | undefined;
}): EffectivePiConfig => {
  const agentDir =
    input.config?.agentDir === undefined
      ? undefined
      : resolveConfigRelativePath(input.pathService, input.configPath, input.config.agentDir);
  const sessionDir =
    input.config?.sessionDir === undefined
      ? undefined
      : resolveConfigRelativePath(input.pathService, input.configPath, input.config.sessionDir);
  const defaultModel = input.config?.defaultModel;
  const defaultThinking = input.config?.defaultThinking;
  const tools = input.config?.tools;
  const excludeTools = input.config?.excludeTools;
  const noTools = input.config?.noTools;

  return EffectivePiConfig.make({
    enabled: input.config?.enabled ?? false,
    ...(agentDir === undefined ? {} : { agentDir }),
    ...(sessionDir === undefined ? {} : { sessionDir }),
    ...(defaultModel === undefined ? {} : { defaultModel }),
    ...(defaultThinking === undefined ? {} : { defaultThinking }),
    ...(tools === undefined ? {} : { tools }),
    ...(excludeTools === undefined ? {} : { excludeTools }),
    ...(noTools === undefined ? {} : { noTools }),
  });
};

/** Normalize decoded file config, resolve enabled secrets, and fill defaults. */
export const resolveEffectiveServerConfig = Effect.fn("server.resolveEffectiveServerConfig")(function* (
  input: {
    readonly configPath: string;
    readonly fileConfig: ServerFileConfig | null;
  },
) {
  const pathService = yield* Path.Path;
  const config = input.fileConfig ?? ServerFileConfig.make({});
  const defaultWorkingDirectory = resolveConfigRelativePath(
    pathService,
    input.configPath,
    config.defaultWorkingDirectory ?? homedir(),
  );
  const telegram = yield* normalizeTelegram({
    configPath: input.configPath,
    config: config.chats?.telegram,
  });
  const discord = yield* normalizeDiscord({
    configPath: input.configPath,
    config: config.chats?.discord,
  });
  const opencode = yield* normalizeOpenCode({
    configPath: input.configPath,
    config: config.harnesses?.opencode,
  });

  const middleware = config.middleware;

  return EffectiveServerConfig.make({
    userName: config.userName ?? defaultUserName(),
    defaultWorkingDirectory,
    deliveryMode: config.deliveryMode ?? "requester_only",
    server: normalizeServerSettings(config.server),
    chats: EffectiveChatsConfig.make({ telegram, discord }),
    harnesses: EffectiveHarnessesConfig.make({
      opencode,
      pi: normalizePi({
        pathService,
        configPath: input.configPath,
        config: config.harnesses?.pi,
      }),
    }),
    ...(middleware === undefined ? {} : { middleware }),
  });
});

/** Load config from disk into the internal, resolved runtime shape. */
export const loadEffectiveServerConfig = Effect.fn("server.loadEffectiveServerConfig")(function* (
  configPath: string,
) {
  const fileConfig = yield* loadServerConfigFile(configPath);
  return yield* resolveEffectiveServerConfig({ configPath, fileConfig });
});

const issueFromConfigError = (error: ConfigError): ConfigValidationIssue =>
  ConfigValidationIssue.make({
    code: error._tag,
    message: error.message,
    path: error.path,
  });

/** Validate current config path without constructing adapters or starting runtime work. */
export const validateServerConfig = Effect.fn("server.validateServerConfig")(function* (
  configPath: string,
) {
  return yield* loadEffectiveServerConfig(configPath).pipe(
    Effect.match({
      onFailure: (error) =>
        ConfigValidateResponse.make({
          version: CONTROL_RESPONSE_VERSION,
          configPath,
          valid: false,
          issues: [issueFromConfigError(error)],
        }),
      onSuccess: (effective) =>
        ConfigValidateResponse.make({
          version: CONTROL_RESPONSE_VERSION,
          configPath,
          valid: true,
          issues: [],
          config: redactServerConfig(effective),
        }),
    }),
  );
});

/** ServerConfig owns the currently loaded effective config for control routes. */
export class ServerConfig extends Context.Service<
  ServerConfig,
  {
    readonly loadCurrent: (configPath: string) => Effect.Effect<EffectiveServerConfig, ConfigError>;
    readonly getEffective: Effect.Effect<EffectiveServerConfig, ConfigValidationError>;
    readonly getRedacted: Effect.Effect<EffectiveConfigResponse, ConfigValidationError>;
    readonly validateCurrent: Effect.Effect<ConfigValidateResponse>;
  }
>()("@xmux/server/ServerConfig") {}

/** Live config service captures platform dependencies once and exposes a testable API. */
export const ServerConfigLive = Layer.effect(ServerConfig)(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const secretResolver = yield* SecretResolver;
    const current = yield* Ref.make<LoadedConfig | null>(null);

    const loadCurrent = (configPath: string): Effect.Effect<EffectiveServerConfig, ConfigError> =>
      loadEffectiveServerConfig(configPath).pipe(
        Effect.tap((effective) => Ref.set(current, { configPath, effective })),
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, pathService),
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
          EffectiveConfigResponse.make({
            version: CONTROL_RESPONSE_VERSION,
            configPath: loaded.configPath,
            config: redactServerConfig(loaded.effective),
          }),
        ),
      ),
      validateCurrent: Ref.get(current).pipe(
        Effect.flatMap((loaded) =>
          loaded === null
            ? Effect.succeed(
                ConfigValidateResponse.make({
                  version: CONTROL_RESPONSE_VERSION,
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
        Effect.provideService(SecretResolver, secretResolver),
      ),
    };
  }),
);
