import {
  RedactedChatsConfig,
  RedactedDiscordConfig,
  RedactedHarnessesConfig,
  RedactedOpenCodeConfig,
  RedactedPiConfig,
  RedactedEnvSecretRef,
  RedactedInlineSecretRef,
  RedactedSecretRef,
  RedactedServerConfig,
  RedactedSlackConfig,
  RedactedSttConfig,
  RedactedTelegramConfig,
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

const redactStt = (stt: EffectiveSttConfig): RedactedSttConfig =>
  RedactedSttConfig.make({
    provider: stt.provider,
    ...(stt.apiKey === undefined ? {} : { apiKey: redactSecret(stt.apiKey) }),
    ...(stt.baseUrl === undefined ? {} : { baseUrl: stt.baseUrl }),
    ...(stt.endpointPath === undefined ? {} : { endpointPath: stt.endpointPath }),
    model: stt.model,
    ...(stt.language === undefined ? {} : { language: stt.language }),
    maxBytes: stt.maxBytes,
    ...(stt.timeoutMs === undefined ? {} : { timeoutMs: stt.timeoutMs }),
  });

const redactTelegram = (telegram: EffectiveTelegramConfig): RedactedTelegramConfig =>
  RedactedTelegramConfig.make({
    token: redactSecret(telegram.token),
    access: telegram.access,
  });

const redactDiscord = (discord: EffectiveDiscordConfig): RedactedDiscordConfig =>
  RedactedDiscordConfig.make({
    token: redactSecret(discord.token),
    applicationId: discord.applicationId,
    guildId: discord.guildId,
    access: discord.access,
  });

const redactSlack = (slack: EffectiveSlackConfig): RedactedSlackConfig =>
  RedactedSlackConfig.make({
    botToken: redactSecret(slack.botToken),
    appToken: redactSecret(slack.appToken),
    access: slack.access,
  });

const redactOpenCode = (opencode: EffectiveOpenCodeConfig): RedactedOpenCodeConfig =>
  RedactedOpenCodeConfig.make({
    runtime: opencode.runtime,
    ...(opencode.defaultModel === undefined ? {} : { defaultModel: opencode.defaultModel }),
    ...(opencode.defaultThinking === undefined
      ? {}
      : { defaultThinking: opencode.defaultThinking }),
  });

const redactPi = (pi: EffectivePiConfig): RedactedPiConfig =>
  RedactedPiConfig.make({
    ...(pi.agentDir === undefined ? {} : { agentDir: pi.agentDir }),
    ...(pi.sessionDir === undefined ? {} : { sessionDir: pi.sessionDir }),
    ...(pi.defaultModel === undefined ? {} : { defaultModel: pi.defaultModel }),
    ...(pi.defaultThinking === undefined ? {} : { defaultThinking: pi.defaultThinking }),
  });

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
