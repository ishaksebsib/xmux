import {
  createDiscordAdapter,
  type DiscordAdapterData,
  type DiscordAdapterOptions,
} from "@xmux/chat-adapter-discord";
import {
  createSlackAdapter,
  type SlackAdapterData,
  type SlackAdapterOptions,
} from "@xmux/chat-adapter-slack";
import {
  createTelegramAdapter,
  type TelegramAdapterData,
  type TelegramAdapterOptions,
} from "@xmux/chat-adapter-telegram";
import type { ChatAdapterDefinition } from "@xmux/chat-core";
import {
  createOpenCodeAdapter,
  type OpenCodeAdapter,
  type OpenCodeAdapterConfig,
} from "@xmux/harness-opencode";
import { createPiAdapter, type PiAdapter, type PiAdapterConfig } from "@xmux/harness-pi";
import { Redacted } from "effect";
import type {
  EnabledEffectiveDiscordConfig,
  EnabledEffectiveOpenCodeConfig,
  EnabledEffectivePiConfig,
  EnabledEffectiveSlackConfig,
  EnabledEffectiveTelegramConfig,
  ResolvedSecretType,
} from "../../../config/effective";

export type ServerTelegramAdapter = ChatAdapterDefinition<
  "telegram",
  TelegramAdapterOptions,
  TelegramAdapterData
>;
export type ServerDiscordAdapter = ChatAdapterDefinition<
  "discord",
  DiscordAdapterOptions,
  DiscordAdapterData
>;
export type ServerSlackAdapter = ChatAdapterDefinition<
  "slack",
  SlackAdapterOptions,
  SlackAdapterData
>;
export type ServerOpenCodeAdapter = OpenCodeAdapter;
export type ServerPiAdapter = PiAdapter;

const secretValue = (secret: ResolvedSecretType): string => Redacted.value(secret.value);

export const makeTelegramAdapter = (
  config: EnabledEffectiveTelegramConfig,
): ServerTelegramAdapter =>
  createTelegramAdapter({
    token: secretValue(config.token),
    mode: { type: "polling", dropPendingUpdates: true },
  });

export const makeDiscordAdapter = (config: EnabledEffectiveDiscordConfig): ServerDiscordAdapter =>
  createDiscordAdapter({
    token: secretValue(config.token),
    applicationId: config.applicationId,
    mode: { type: "gateway", observeMessages: true, observeReactions: true },
    commandRegistration: {
      scope: { type: "guild", guildId: config.guildId },
      strategy: "bulk-overwrite",
    },
  });

export const makeSlackAdapter = (config: EnabledEffectiveSlackConfig): ServerSlackAdapter =>
  createSlackAdapter({
    botToken: secretValue(config.botToken),
    mode: { type: "socket", appToken: secretValue(config.appToken) },
    mentionCommands: { enabled: true },
    conversationScope: "thread",
  });

const mapOpenCodeConfig = (config: EnabledEffectiveOpenCodeConfig): OpenCodeAdapterConfig => {
  const shared = {
    ...(config.defaultModel === undefined ? {} : { defaultModel: config.defaultModel }),
    ...(config.defaultThinking === undefined ? {} : { defaultThinking: config.defaultThinking }),
  };

  if (config.runtime.type === "external") {
    return {
      ...shared,
      mode: "external",
      baseUrl: config.runtime.baseUrl,
    };
  }

  return {
    ...shared,
    mode: "embedded",
    ...(config.runtime.port === undefined ? {} : { port: config.runtime.port }),
  };
};

const mapPiConfig = (config: EnabledEffectivePiConfig): PiAdapterConfig => ({
  ...(config.agentDir === undefined ? {} : { agentDir: config.agentDir }),
  ...(config.sessionDir === undefined ? {} : { sessionDir: config.sessionDir }),
  ...(config.defaultModel === undefined ? {} : { defaultModel: config.defaultModel }),
  ...(config.defaultThinking === undefined ? {} : { defaultThinking: config.defaultThinking }),
});

export const makeOpenCodeAdapter = (
  config: EnabledEffectiveOpenCodeConfig,
): ServerOpenCodeAdapter => createOpenCodeAdapter(mapOpenCodeConfig(config));

export const makePiAdapter = (config: EnabledEffectivePiConfig): ServerPiAdapter =>
  createPiAdapter(mapPiConfig(config));
