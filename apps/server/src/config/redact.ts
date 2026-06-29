import {
  DisabledIntegrationConfig,
  RedactedChatsConfig,
  RedactedEnabledDiscordConfig,
  RedactedEnabledOpenCodeConfig,
  RedactedEnabledPiConfig,
  RedactedEnabledSlackConfig,
  RedactedEnabledSttConfig,
  RedactedEnabledTelegramConfig,
  RedactedEnvSecretRef,
  RedactedHarnessesConfig,
  RedactedInlineSecretRef,
  RedactedSecretRef,
  RedactedServerConfig,
} from "../contracts/config";
import type {
  EffectiveDiscordConfig,
  EffectiveOpenCodeConfig,
  EffectivePiConfig,
  EffectiveServerConfig,
  EffectiveSlackConfig,
  EffectiveSttConfig,
  EffectiveTelegramConfig,
  ResolvedSecret,
} from "./effective";

const redactSecret = (secret: ResolvedSecret): RedactedSecretRef => {
  if (secret.source === "env") {
    return RedactedEnvSecretRef.make({
      source: "env",
      env: secret.env,
      redacted: true,
    });
  }

  return RedactedInlineSecretRef.make({
    source: "value",
    redacted: true,
  });
};

const redactStt = (stt: EffectiveSttConfig) => {
  if (!stt.enabled) return DisabledIntegrationConfig.make({ enabled: false });

  return RedactedEnabledSttConfig.make({
    enabled: true,
    provider: stt.provider,
    ...(stt.apiKey === undefined ? {} : { apiKey: redactSecret(stt.apiKey) }),
    ...(stt.baseUrl === undefined ? {} : { baseUrl: stt.baseUrl }),
    ...(stt.endpointPath === undefined ? {} : { endpointPath: stt.endpointPath }),
    model: stt.model,
    ...(stt.language === undefined ? {} : { language: stt.language }),
    maxBytes: stt.maxBytes,
    ...(stt.timeoutMs === undefined ? {} : { timeoutMs: stt.timeoutMs }),
  });
};

const redactTelegram = (telegram: EffectiveTelegramConfig) => {
  if (!telegram.enabled) return DisabledIntegrationConfig.make({ enabled: false });

  return RedactedEnabledTelegramConfig.make({
    enabled: true,
    token: redactSecret(telegram.token),
    access: telegram.access,
  });
};

const redactDiscord = (discord: EffectiveDiscordConfig) => {
  if (!discord.enabled) return DisabledIntegrationConfig.make({ enabled: false });

  return RedactedEnabledDiscordConfig.make({
    enabled: true,
    token: redactSecret(discord.token),
    applicationId: discord.applicationId,
    guildId: discord.guildId,
    access: discord.access,
  });
};

const redactSlack = (slack: EffectiveSlackConfig) => {
  if (!slack.enabled) return DisabledIntegrationConfig.make({ enabled: false });

  return RedactedEnabledSlackConfig.make({
    enabled: true,
    botToken: redactSecret(slack.botToken),
    appToken: redactSecret(slack.appToken),
    access: slack.access,
  });
};

const redactOpenCode = (opencode: EffectiveOpenCodeConfig) => {
  if (!opencode.enabled) return DisabledIntegrationConfig.make({ enabled: false });

  return RedactedEnabledOpenCodeConfig.make({
    enabled: true,
    runtime: opencode.runtime,
    ...(opencode.defaultModel === undefined ? {} : { defaultModel: opencode.defaultModel }),
    ...(opencode.defaultThinking === undefined
      ? {}
      : { defaultThinking: opencode.defaultThinking }),
  });
};

const redactPi = (pi: EffectivePiConfig) => {
  if (!pi.enabled) return DisabledIntegrationConfig.make({ enabled: false });

  return RedactedEnabledPiConfig.make({
    enabled: true,
    ...(pi.agentDir === undefined ? {} : { agentDir: pi.agentDir }),
    ...(pi.sessionDir === undefined ? {} : { sessionDir: pi.sessionDir }),
    ...(pi.defaultModel === undefined ? {} : { defaultModel: pi.defaultModel }),
    ...(pi.defaultThinking === undefined ? {} : { defaultThinking: pi.defaultThinking }),
  });
};

/** Redact effective runtime config before it crosses the control boundary. */
export const redactServerConfig = (config: EffectiveServerConfig): RedactedServerConfig =>
  RedactedServerConfig.make({
    xmux: config.xmux,
    server: config.server,
    ...(config.stt === undefined ? {} : { stt: redactStt(config.stt) }),
    chats: RedactedChatsConfig.make({
      ...(config.chats.telegram === undefined
        ? {}
        : { telegram: redactTelegram(config.chats.telegram) }),
      ...(config.chats.discord === undefined
        ? {}
        : { discord: redactDiscord(config.chats.discord) }),
      ...(config.chats.slack === undefined ? {} : { slack: redactSlack(config.chats.slack) }),
    }),
    harnesses: RedactedHarnessesConfig.make({
      ...(config.harnesses.opencode === undefined
        ? {}
        : { opencode: redactOpenCode(config.harnesses.opencode) }),
      ...(config.harnesses.pi === undefined ? {} : { pi: redactPi(config.harnesses.pi) }),
    }),
  });
