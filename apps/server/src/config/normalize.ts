import { Effect, Path } from "effect";
import {
  type ChatAttachmentKindConfig,
  ConfigValidationIssue,
  type DiscordFileConfig,
  type OpenCodeFileConfig,
  OpenCodeEmbeddedRuntimeConfig,
  type PiFileConfig,
  type SecretRef,
  type ServerFileServerConfig,
  ServerFileConfig,
  ServerLogRotationConfig,
  ServerLogsConfig,
  ServerSettingsConfig,
  type SlackFileConfig,
  type SttFileConfig,
  type TelegramFileConfig,
  InvalidConfigValidationResult,
  LsCommandConfig,
  ModelCommandConfig,
  ResumeCommandConfig,
  ValidConfigValidationResult,
  XmuxAttachmentsConfig,
  type XmuxFileConfig,
  XmuxCommandsConfig,
  XmuxResponsesConfig,
  XmuxSettingsConfig,
  XmuxThinkingResponseConfig,
  XmuxToolResponseConfig,
  XmuxWorkspaceSettingsConfig,
} from "../contracts/config";
import {
  ConfigPath,
  logByteCountFromNumber,
  logRotationFileCountFromNumber,
  resolvedPathFromString,
  type ResolvedPath,
} from "../contracts/primitives";
import { ConfigValidationError, type ConfigError } from "../errors";
import { DEFAULT_MAX_LOG_FILE_BYTES, DEFAULT_MAX_LOG_FILES } from "../logging/file-logger";
import { HostRuntime } from "../platform/host";
import { expandHome } from "../platform/path";
import {
  EffectiveChatsConfig,
  EffectiveDiscordConfig,
  EffectiveHarnessesConfig,
  EffectiveOpenCodeConfig,
  EffectivePiConfig,
  EffectiveServerConfig,
  EffectiveSlackConfig,
  EffectiveSttConfig,
  EffectiveTelegramConfig,
} from "./effective";
import { loadServerConfigFile } from "./load-jsonc";
import { redactServerConfig } from "./redact";
import { resolveSecretRef } from "./resolve-secrets";

const DEFAULT_MAX_LIST_ENTRIES = 100;
const DEFAULT_MAX_RESUME_SESSIONS_PER_HARNESS = 5;
const DEFAULT_MAX_MODELS_PER_PROVIDER = 10;
const DEFAULT_MAX_THINKING_CHARS = 320;
const DEFAULT_MAX_TOOL_INPUT_STRING_CHARS = 50;
const DEFAULT_MAX_TOOL_INPUT_OBJECT_ENTRIES = 2;
const DEFAULT_MAX_TOOL_TEXT_OUTPUT_CHARS = 280;
const DEFAULT_MAX_TOOL_JSON_OUTPUT_CHARS = 400;
const DEFAULT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_STT_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_ATTACHMENT_KINDS: readonly ChatAttachmentKindConfig[] = [
  "image",
  "audio",
  "video",
  "document",
  "archive",
  "other",
];

const resolveConfigRelativePath = (
  pathService: Path.Path,
  homeDir: string,
  configPath: ConfigPath,
  input: string,
): ResolvedPath => {
  const expanded = expandHome(pathService, homeDir, input);
  const resolved = pathService.isAbsolute(expanded)
    ? pathService.resolve(expanded)
    : pathService.resolve(pathService.dirname(configPath), expanded);
  return resolvedPathFromString(resolved);
};

const validationError = (input: {
  readonly configPath: ConfigPath;
  readonly message: string;
}): ConfigValidationError =>
  ConfigValidationError.make({ path: input.configPath, message: input.message });

const requireConfigField = <A>(input: {
  readonly value: A | undefined;
  readonly configPath: ConfigPath;
  readonly message: string;
}): Effect.Effect<A, ConfigValidationError> =>
  Effect.gen(function* () {
    const value = input.value;
    if (value === undefined) {
      return yield* validationError({ configPath: input.configPath, message: input.message });
    }
    return value;
  });

const normalizeServerSettings = (
  settings: ServerFileServerConfig | undefined,
): ServerSettingsConfig =>
  ServerSettingsConfig.make({
    logs: ServerLogsConfig.make({
      level: settings?.logs?.level ?? "info",
      rotation: ServerLogRotationConfig.make({
        maxBytes:
          settings?.logs?.rotation?.maxBytes ?? logByteCountFromNumber(DEFAULT_MAX_LOG_FILE_BYTES),
        maxFiles:
          settings?.logs?.rotation?.maxFiles ??
          logRotationFileCountFromNumber(DEFAULT_MAX_LOG_FILES),
      }),
    }),
  });

const uniqueAttachmentKinds = (
  kinds: readonly ChatAttachmentKindConfig[] | undefined,
): readonly ChatAttachmentKindConfig[] => {
  const unique: ChatAttachmentKindConfig[] = [];
  for (const kind of kinds ?? DEFAULT_ATTACHMENT_KINDS) {
    if (!unique.includes(kind)) unique.push(kind);
  }
  return unique;
};

const normalizeXmux = (input: {
  readonly pathService: Path.Path;
  readonly homeDir: string;
  readonly configPath: ConfigPath;
  readonly config: XmuxFileConfig | undefined;
}): XmuxSettingsConfig => {
  const workspace = input.config?.workspace;
  const responses = input.config?.responses;
  const commands = input.config?.commands;
  const attachments = input.config?.attachments;
  const defaultDir = resolveConfigRelativePath(
    input.pathService,
    input.homeDir,
    input.configPath,
    workspace?.defaultDir ?? input.homeDir,
  );

  return XmuxSettingsConfig.make({
    workspace: XmuxWorkspaceSettingsConfig.make({ defaultDir }),
    responses: XmuxResponsesConfig.make({
      thinking: XmuxThinkingResponseConfig.make({
        hide: responses?.thinking?.hide ?? false,
        maxChars: responses?.thinking?.maxChars ?? DEFAULT_MAX_THINKING_CHARS,
      }),
      tools: XmuxToolResponseConfig.make({
        hide: responses?.tools?.hide ?? false,
        maxInputStringChars:
          responses?.tools?.maxInputStringChars ?? DEFAULT_MAX_TOOL_INPUT_STRING_CHARS,
        maxInputObjectEntries:
          responses?.tools?.maxInputObjectEntries ?? DEFAULT_MAX_TOOL_INPUT_OBJECT_ENTRIES,
        maxTextOutputChars:
          responses?.tools?.maxTextOutputChars ?? DEFAULT_MAX_TOOL_TEXT_OUTPUT_CHARS,
        maxJsonOutputChars:
          responses?.tools?.maxJsonOutputChars ?? DEFAULT_MAX_TOOL_JSON_OUTPUT_CHARS,
      }),
    }),
    commands: XmuxCommandsConfig.make({
      resume: ResumeCommandConfig.make({
        maxSessionsPerHarness:
          commands?.resume?.maxSessionsPerHarness ?? DEFAULT_MAX_RESUME_SESSIONS_PER_HARNESS,
      }),
      model: ModelCommandConfig.make({
        maxModelsPerProvider:
          commands?.model?.maxModelsPerProvider ?? DEFAULT_MAX_MODELS_PER_PROVIDER,
      }),
      ls: LsCommandConfig.make({
        showHidden: commands?.ls?.showHidden ?? false,
        maxEntries: commands?.ls?.maxEntries ?? DEFAULT_MAX_LIST_ENTRIES,
      }),
    }),
    attachments: XmuxAttachmentsConfig.make({
      enabled: attachments?.enabled ?? true,
      maxBytes: attachments?.maxBytes ?? DEFAULT_ATTACHMENT_MAX_BYTES,
      kinds: uniqueAttachmentKinds(attachments?.kinds),
    }),
  });
};

const requireAccessMessage = (path: string): string =>
  `${path} is missing. Set it to { "type": "allow-list", "users": [...] } or { "type": "anyone" }.`;

const requireResolvedSecret = Effect.fn("server.normalize.requireResolvedSecret")(
  function* (input: {
    readonly ref: SecretRef | undefined;
    readonly configPath: ConfigPath;
    readonly message: string;
  }) {
    const ref = yield* requireConfigField({
      value: input.ref,
      configPath: input.configPath,
      message: input.message,
    });
    return yield* resolveSecretRef({ configPath: input.configPath, ref });
  },
);

const normalizeTelegram = Effect.fn("server.normalizeTelegramConfig")(function* (input: {
  readonly configPath: ConfigPath;
  readonly config: TelegramFileConfig | undefined;
}) {
  if (input.config === undefined) return undefined;

  const token = yield* requireResolvedSecret({
    ref: input.config.token,
    configPath: input.configPath,
    message: "Telegram chat is configured but chats.telegram.token is missing.",
  });
  const access = yield* requireConfigField({
    value: input.config.access,
    configPath: input.configPath,
    message: requireAccessMessage("chats.telegram.access"),
  });

  return EffectiveTelegramConfig.make({ token, access });
});

const normalizeDiscord = Effect.fn("server.normalizeDiscordConfig")(function* (input: {
  readonly configPath: ConfigPath;
  readonly config: DiscordFileConfig | undefined;
}) {
  if (input.config === undefined) return undefined;

  const token = yield* requireResolvedSecret({
    ref: input.config.token,
    configPath: input.configPath,
    message: "Discord chat is configured but chats.discord.token is missing.",
  });
  const applicationId = yield* requireConfigField({
    value: input.config.applicationId,
    configPath: input.configPath,
    message: "Discord chat is configured but chats.discord.applicationId is missing.",
  });
  const guildId = yield* requireConfigField({
    value: input.config.guildId,
    configPath: input.configPath,
    message: "Discord chat is configured but chats.discord.guildId is missing.",
  });
  const access = yield* requireConfigField({
    value: input.config.access,
    configPath: input.configPath,
    message: requireAccessMessage("chats.discord.access"),
  });

  return EffectiveDiscordConfig.make({ token, applicationId, guildId, access });
});

const normalizeSlack = Effect.fn("server.normalizeSlackConfig")(function* (input: {
  readonly configPath: ConfigPath;
  readonly config: SlackFileConfig | undefined;
}) {
  if (input.config === undefined) return undefined;

  const botToken = yield* requireResolvedSecret({
    ref: input.config.botToken,
    configPath: input.configPath,
    message: "Slack chat is configured but chats.slack.botToken is missing.",
  });
  const appToken = yield* requireResolvedSecret({
    ref: input.config.appToken,
    configPath: input.configPath,
    message: "Slack chat is configured but chats.slack.appToken is missing.",
  });
  const access = yield* requireConfigField({
    value: input.config.access,
    configPath: input.configPath,
    message: requireAccessMessage("chats.slack.access"),
  });

  return EffectiveSlackConfig.make({ botToken, appToken, access });
});

const normalizeStt = Effect.fn("server.normalizeSttConfig")(function* (input: {
  readonly configPath: ConfigPath;
  readonly config: SttFileConfig | undefined;
}) {
  if (input.config === undefined) return undefined;

  const model = yield* requireConfigField({
    value: input.config.model,
    configPath: input.configPath,
    message: "STT is configured but stt.model is missing.",
  });
  const apiKey =
    input.config.apiKey === undefined
      ? undefined
      : yield* resolveSecretRef({ configPath: input.configPath, ref: input.config.apiKey });

  return EffectiveSttConfig.make({
    provider: input.config.provider ?? "openai-compatible",
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(input.config.baseUrl === undefined ? {} : { baseUrl: input.config.baseUrl }),
    ...(input.config.endpointPath === undefined ? {} : { endpointPath: input.config.endpointPath }),
    model,
    ...(input.config.language === undefined ? {} : { language: input.config.language }),
    maxBytes: input.config.maxBytes ?? DEFAULT_STT_MAX_BYTES,
    ...(input.config.timeoutMs === undefined ? {} : { timeoutMs: input.config.timeoutMs }),
  });
});

const normalizeOpenCode = (
  config: OpenCodeFileConfig | undefined,
): EffectiveOpenCodeConfig | undefined => {
  if (config === undefined) return undefined;

  const runtime = config.runtime ?? OpenCodeEmbeddedRuntimeConfig.make({ type: "embedded" });
  return EffectiveOpenCodeConfig.make({
    runtime,
    ...(config.defaultModel === undefined ? {} : { defaultModel: config.defaultModel }),
    ...(config.defaultThinking === undefined ? {} : { defaultThinking: config.defaultThinking }),
  });
};

const normalizePi = (input: {
  readonly pathService: Path.Path;
  readonly homeDir: string;
  readonly configPath: ConfigPath;
  readonly config: PiFileConfig | undefined;
}): EffectivePiConfig | undefined => {
  if (input.config === undefined) return undefined;

  const agentDir =
    input.config.agentDir === undefined
      ? undefined
      : resolveConfigRelativePath(
          input.pathService,
          input.homeDir,
          input.configPath,
          input.config.agentDir,
        );
  const sessionDir =
    input.config.sessionDir === undefined
      ? undefined
      : resolveConfigRelativePath(
          input.pathService,
          input.homeDir,
          input.configPath,
          input.config.sessionDir,
        );

  return EffectivePiConfig.make({
    ...(agentDir === undefined ? {} : { agentDir }),
    ...(sessionDir === undefined ? {} : { sessionDir }),
    ...(input.config.defaultModel === undefined ? {} : { defaultModel: input.config.defaultModel }),
    ...(input.config.defaultThinking === undefined
      ? {}
      : { defaultThinking: input.config.defaultThinking }),
  });
};

/** Normalize decoded file config, resolve enabled secrets, and fill defaults. */
export const resolveEffectiveServerConfig = Effect.fn("server.resolveEffectiveServerConfig")(
  function* (input: {
    readonly configPath: ConfigPath;
    readonly fileConfig: ServerFileConfig | null;
  }) {
    const pathService = yield* Path.Path;
    const host = yield* HostRuntime;
    const config = input.fileConfig ?? ServerFileConfig.make({});
    const xmux = normalizeXmux({
      pathService,
      homeDir: host.homeDir,
      configPath: input.configPath,
      config: config.xmux,
    });
    const stt = yield* normalizeStt({ configPath: input.configPath, config: config.stt });
    const telegram = yield* normalizeTelegram({
      configPath: input.configPath,
      config: config.chats?.telegram,
    });
    const discord = yield* normalizeDiscord({
      configPath: input.configPath,
      config: config.chats?.discord,
    });
    const slack = yield* normalizeSlack({
      configPath: input.configPath,
      config: config.chats?.slack,
    });
    const opencode = normalizeOpenCode(config.harnesses?.opencode);
    const pi = normalizePi({
      pathService,
      homeDir: host.homeDir,
      configPath: input.configPath,
      config: config.harnesses?.pi,
    });

    return EffectiveServerConfig.make({
      xmux,
      server: normalizeServerSettings(config.server),
      ...(stt === undefined ? {} : { stt }),
      chats: EffectiveChatsConfig.make({
        ...(telegram === undefined ? {} : { telegram }),
        ...(discord === undefined ? {} : { discord }),
        ...(slack === undefined ? {} : { slack }),
      }),
      harnesses: EffectiveHarnessesConfig.make({
        ...(opencode === undefined ? {} : { opencode }),
        ...(pi === undefined ? {} : { pi }),
      }),
    });
  },
);

/** Load config from disk into the internal, resolved runtime shape. */
export const loadEffectiveServerConfig = Effect.fn("server.loadEffectiveServerConfig")(function* (
  configPath: ConfigPath,
) {
  const fileConfig = yield* loadServerConfigFile(configPath);
  return yield* resolveEffectiveServerConfig({ configPath, fileConfig });
});

const issueFromConfigError = (error: ConfigError): ConfigValidationIssue =>
  ConfigValidationIssue.make({
    code: error._tag,
    message: error.message,
    ...("path" in error ? { path: error.path } : {}),
  });

/** Validate current config path without constructing adapters or starting runtime work. */
export const validateServerConfig = Effect.fn("server.validateServerConfig")(function* (
  configPath: ConfigPath,
) {
  return yield* loadEffectiveServerConfig(configPath).pipe(
    Effect.match({
      onFailure: (error) =>
        InvalidConfigValidationResult.make({
          configPath,
          valid: false,
          issues: [issueFromConfigError(error)],
        }),
      onSuccess: (effective) =>
        ValidConfigValidationResult.make({
          configPath,
          valid: true,
          issues: [],
          config: redactServerConfig(effective),
        }),
    }),
  );
});
