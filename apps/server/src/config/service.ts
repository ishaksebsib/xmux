import { Context, Effect, FileSystem, Layer, Path, Ref } from "effect";
import {
  ConfigValidationIssue,
  ConfigValidationResult,
  DiscordModeConfig,
  type DiscordFileConfig,
  type OpenCodeFileConfig,
  type PiFileConfig,
  RedactedConfigSnapshot,
  ServerFileConfig,
  TelegramModeConfig,
  type TelegramFileConfig,
  type ServerFileServerConfig,
} from "../contracts/config";
import { ConfigValidationError, type ConfigError } from "../errors";
import { HostRuntime } from "../runtime/host";
import { loadServerConfigFile } from "./load-jsonc";
import { redactServerConfig } from "./redact";
import { resolveSecretRef, SecretResolver } from "./resolve-secrets";
import {
  EffectiveChatsConfig,
  EffectiveDiscordDisabled,
  EffectiveDiscordGatewayEnabled,
  EffectiveDiscordGatewayMode,
  EffectiveDiscordWebhookEnabled,
  EffectiveDiscordWebhookMode,
  EffectiveHarnessesConfig,
  EffectiveOpenCodeDisabled,
  EffectiveOpenCodeEmbedded,
  EffectiveOpenCodeExternal,
  type EffectivePiConfig,
  EffectivePiDisabled,
  EffectivePiEnabled,
  EffectiveServerConfig,
  EffectiveServerSettings,
  EffectiveTelegramDisabled,
  EffectiveTelegramEnabled,
} from "./schema";

interface LoadedConfig {
  readonly configPath: string;
  readonly effective: EffectiveServerConfig;
}

const DEFAULT_USER_NAME = "xmux";

const expandHome = (pathService: Path.Path, homeDir: string, input: string): string => {
  if (input === "~") return homeDir;
  if (input.startsWith("~/")) return pathService.join(homeDir, input.slice(2));
  return input;
};

const resolveConfigRelativePath = (
  pathService: Path.Path,
  homeDir: string,
  configPath: string,
  input: string,
): string => {
  const expanded = expandHome(pathService, homeDir, input);
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
  if (!enabled) return EffectiveTelegramDisabled.make({ enabled: false, mode });

  if (input.config?.token === undefined) {
    return yield* validationError({
      configPath: input.configPath,
      message: "Telegram is enabled but chats.telegram.token is missing.",
    });
  }

  const token = yield* resolveSecretRef({ configPath: input.configPath, ref: input.config.token });
  return EffectiveTelegramEnabled.make({ enabled: true, token, mode });
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
    return EffectiveDiscordDisabled.make({
      enabled: false,
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
  if (mode.type === "webhook") {
    if (publicKey === undefined) {
      return yield* validationError({
        configPath: input.configPath,
        message: "Discord webhook mode requires chats.discord.publicKey.",
      });
    }

    return EffectiveDiscordWebhookEnabled.make({
      enabled: true,
      token,
      applicationId,
      publicKey,
      mode: EffectiveDiscordWebhookMode.make({ type: "webhook" }),
      ...(guildId === undefined ? {} : { guildId }),
    });
  }

  return EffectiveDiscordGatewayEnabled.make({
    enabled: true,
    token,
    applicationId,
    mode: EffectiveDiscordGatewayMode.make({ type: "gateway" }),
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

  const enabled = input.config?.enabled ?? false;
  if (!enabled) {
    return EffectiveOpenCodeDisabled.make({
      enabled: false,
      mode,
      ...(baseUrl === undefined ? {} : { baseUrl }),
      ...(port === undefined ? {} : { port }),
      ...(defaultModel === undefined ? {} : { defaultModel }),
      ...(defaultThinking === undefined ? {} : { defaultThinking }),
    });
  }

  if (mode === "external") {
    if (baseUrl === undefined) {
      return yield* validationError({
        configPath: input.configPath,
        message: "OpenCode external mode requires harnesses.opencode.baseUrl.",
      });
    }

    return EffectiveOpenCodeExternal.make({
      enabled: true,
      mode,
      baseUrl,
      ...(defaultModel === undefined ? {} : { defaultModel }),
      ...(defaultThinking === undefined ? {} : { defaultThinking }),
    });
  }

  return EffectiveOpenCodeEmbedded.make({
    enabled: true,
    mode,
    ...(port === undefined ? {} : { port }),
    ...(defaultModel === undefined ? {} : { defaultModel }),
    ...(defaultThinking === undefined ? {} : { defaultThinking }),
  });
});

const normalizePi = (input: {
  readonly pathService: Path.Path;
  readonly homeDir: string;
  readonly configPath: string;
  readonly config: PiFileConfig | undefined;
}): EffectivePiConfig => {
  const agentDir =
    input.config?.agentDir === undefined
      ? undefined
      : resolveConfigRelativePath(
          input.pathService,
          input.homeDir,
          input.configPath,
          input.config.agentDir,
        );
  const sessionDir =
    input.config?.sessionDir === undefined
      ? undefined
      : resolveConfigRelativePath(
          input.pathService,
          input.homeDir,
          input.configPath,
          input.config.sessionDir,
        );
  const defaultModel = input.config?.defaultModel;
  const defaultThinking = input.config?.defaultThinking;
  const tools = input.config?.tools;
  const excludeTools = input.config?.excludeTools;
  const noTools = input.config?.noTools;

  const makeInput = {
    ...(agentDir === undefined ? {} : { agentDir }),
    ...(sessionDir === undefined ? {} : { sessionDir }),
    ...(defaultModel === undefined ? {} : { defaultModel }),
    ...(defaultThinking === undefined ? {} : { defaultThinking }),
    ...(tools === undefined ? {} : { tools }),
    ...(excludeTools === undefined ? {} : { excludeTools }),
    ...(noTools === undefined ? {} : { noTools }),
  };

  return input.config?.enabled === true
    ? EffectivePiEnabled.make({ enabled: true, ...makeInput })
    : EffectivePiDisabled.make({ enabled: false, ...makeInput });
};

/** Normalize decoded file config, resolve enabled secrets, and fill defaults. */
export const resolveEffectiveServerConfig = Effect.fn("server.resolveEffectiveServerConfig")(
  function* (input: { readonly configPath: string; readonly fileConfig: ServerFileConfig | null }) {
    const pathService = yield* Path.Path;
    const host = yield* HostRuntime;
    const config = input.fileConfig ?? ServerFileConfig.make({});
    const defaultWorkingDirectory = resolveConfigRelativePath(
      pathService,
      host.homeDir,
      input.configPath,
      config.defaultWorkingDirectory ?? host.homeDir,
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
      userName: config.userName ?? DEFAULT_USER_NAME,
      defaultWorkingDirectory,
      deliveryMode: config.deliveryMode ?? "requester_only",
      server: normalizeServerSettings(config.server),
      chats: EffectiveChatsConfig.make({ telegram, discord }),
      harnesses: EffectiveHarnessesConfig.make({
        opencode,
        pi: normalizePi({
          pathService,
          homeDir: host.homeDir,
          configPath: input.configPath,
          config: config.harnesses?.pi,
        }),
      }),
      ...(middleware === undefined ? {} : { middleware }),
    });
  },
);

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
        ConfigValidationResult.make({
          configPath,
          valid: false,
          issues: [issueFromConfigError(error)],
        }),
      onSuccess: (effective) =>
        ConfigValidationResult.make({
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
                ConfigValidationResult.make({
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
