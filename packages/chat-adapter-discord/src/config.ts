import { Result } from "better-result";
import { DiscordConfigurationError } from "./errors";
import type {
  DiscordAdapterMode,
  DiscordAllowedMentions,
  DiscordCommandRegistrationMode,
  DiscordStreamOptions,
} from "./types";

declare const discordApplicationIdBrand: unique symbol;
declare const discordBotTokenBrand: unique symbol;

export type DiscordApplicationId = string & {
  readonly [discordApplicationIdBrand]: true;
};

export type DiscordBotToken = string & {
  readonly [discordBotTokenBrand]: true;
};

export const defaultDiscordAdapterMode = {
  type: "gateway",
} as const satisfies DiscordAdapterMode;

export const defaultDiscordCommandRegistration = {
  scope: { type: "global" },
} as const satisfies DiscordCommandRegistrationMode;

export const defaultDiscordStreamOptions = {
  placeholderText: "…",
  editIntervalMs: 1_000,
} as const satisfies Required<DiscordStreamOptions>;

export function createSafeDiscordAllowedMentions(): DiscordAllowedMentions {
  return { parse: [], replied_user: false };
}

export function normalizeDiscordMode(mode?: DiscordAdapterMode): DiscordAdapterMode {
  return mode ?? defaultDiscordAdapterMode;
}

export function parseDiscordApplicationId(
  applicationId: string,
): Result<DiscordApplicationId, DiscordConfigurationError> {
  return applicationId.trim().length === 0
    ? Result.err(
        new DiscordConfigurationError({
          field: "applicationId",
          reason: "Discord application id must not be empty",
        }),
      )
    : Result.ok(applicationId as DiscordApplicationId);
}

export function parseDiscordBotToken(
  token: string,
): Result<DiscordBotToken, DiscordConfigurationError> {
  return token.trim().length === 0
    ? Result.err(
        new DiscordConfigurationError({
          field: "token",
          reason: "Discord bot token must not be empty",
        }),
      )
    : Result.ok(token as DiscordBotToken);
}
