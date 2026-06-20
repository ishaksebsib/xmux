import {
  RedactedChatsConfig,
  RedactedDiscordConfig,
  RedactedHarnessesConfig,
  RedactedOpenCodeConfig,
  RedactedPiConfig,
  RedactedSecretRef,
  RedactedServerConfig,
  RedactedTelegramConfig,
} from "../contracts/config";
import type {
  EffectiveDiscordConfig,
  EffectiveOpenCodeConfig,
  EffectivePiConfig,
  EffectiveServerConfig,
  EffectiveTelegramConfig,
  ResolvedSecret,
} from "./schema";

const redactSecret = (secret: ResolvedSecret): RedactedSecretRef => {
  if (secret.source === "env" && secret.env !== undefined) {
    return RedactedSecretRef.make({
      source: "env",
      env: secret.env,
      resolved: true,
      redacted: true,
    });
  }

  return RedactedSecretRef.make({
    source: "value",
    resolved: true,
    redacted: true,
  });
};

const redactTelegram = (telegram: EffectiveTelegramConfig): RedactedTelegramConfig => {
  if (telegram.token === undefined) {
    return RedactedTelegramConfig.make({
      enabled: telegram.enabled,
      mode: telegram.mode,
    });
  }

  return RedactedTelegramConfig.make({
    enabled: telegram.enabled,
    token: redactSecret(telegram.token),
    mode: telegram.mode,
  });
};

const redactDiscord = (discord: EffectiveDiscordConfig): RedactedDiscordConfig => {
  const applicationId = discord.applicationId;
  const guildId = discord.guildId;
  const publicKey = discord.publicKey;
  const common = {
    enabled: discord.enabled,
    mode: discord.mode,
    ...(applicationId === undefined ? {} : { applicationId }),
    ...(guildId === undefined ? {} : { guildId }),
    ...(publicKey === undefined ? {} : { publicKey }),
  };
  if (discord.token === undefined) return RedactedDiscordConfig.make(common);
  return RedactedDiscordConfig.make({
    ...common,
    token: redactSecret(discord.token),
  });
};

const redactOpenCode = (opencode: EffectiveOpenCodeConfig): RedactedOpenCodeConfig => {
  const baseUrl = "baseUrl" in opencode ? opencode.baseUrl : undefined;
  const port = "port" in opencode ? opencode.port : undefined;
  const defaultModel = opencode.defaultModel;
  const defaultThinking = opencode.defaultThinking;
  return RedactedOpenCodeConfig.make({
    enabled: opencode.enabled,
    mode: opencode.mode,
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(port === undefined ? {} : { port }),
    ...(defaultModel === undefined ? {} : { defaultModel }),
    ...(defaultThinking === undefined ? {} : { defaultThinking }),
  });
};

const redactPi = (pi: EffectivePiConfig): RedactedPiConfig => {
  const agentDir = pi.agentDir;
  const sessionDir = pi.sessionDir;
  const defaultModel = pi.defaultModel;
  const defaultThinking = pi.defaultThinking;
  const tools = pi.tools;
  const excludeTools = pi.excludeTools;
  const noTools = pi.noTools;
  return RedactedPiConfig.make({
    enabled: pi.enabled,
    ...(agentDir === undefined ? {} : { agentDir }),
    ...(sessionDir === undefined ? {} : { sessionDir }),
    ...(defaultModel === undefined ? {} : { defaultModel }),
    ...(defaultThinking === undefined ? {} : { defaultThinking }),
    ...(tools === undefined ? {} : { tools }),
    ...(excludeTools === undefined ? {} : { excludeTools }),
    ...(noTools === undefined ? {} : { noTools }),
  });
};

/** Redact effective runtime config before it crosses the control boundary. */
export const redactServerConfig = (config: EffectiveServerConfig): RedactedServerConfig =>
  RedactedServerConfig.make({
    userName: config.userName,
    defaultWorkingDirectory: config.defaultWorkingDirectory,
    deliveryMode: config.deliveryMode,
    server: config.server,
    chats: RedactedChatsConfig.make({
      telegram: redactTelegram(config.chats.telegram),
      discord: redactDiscord(config.chats.discord),
    }),
    harnesses: RedactedHarnessesConfig.make({
      opencode: redactOpenCode(config.harnesses.opencode),
      pi: redactPi(config.harnesses.pi),
    }),
    ...(config.middleware === undefined ? {} : { middleware: config.middleware }),
  });
