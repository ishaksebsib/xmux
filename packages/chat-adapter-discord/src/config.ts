import { Result } from "better-result";
import { DiscordConfigurationError } from "./errors";
import type {
  CreateDiscordAdapterOptions,
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

export interface DiscordAdapterConfig {
  readonly token: DiscordBotToken;
  readonly applicationId: DiscordApplicationId;
  readonly mode: DiscordAdapterMode;
  readonly commandRegistration: DiscordCommandRegistrationMode;
  readonly defaultAllowedMentions: DiscordAllowedMentions;
  readonly stream: Required<DiscordStreamOptions>;
}

export const defaultDiscordAdapterMode = {
  type: "gateway",
} as const satisfies DiscordAdapterMode;

export const defaultDiscordCommandRegistration = {
  scope: { type: "none" },
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

export function parseDiscordAdapterConfig<TChatId extends string>(
  options: CreateDiscordAdapterOptions<TChatId>,
): Result<DiscordAdapterConfig, DiscordConfigurationError> {
  return Result.gen(function* () {
    const token = yield* parseDiscordBotToken(options.token);
    const applicationId = yield* parseDiscordApplicationId(options.applicationId);
    const mode = yield* validateDiscordMode(normalizeDiscordMode(options.mode));
    const commandRegistration = yield* normalizeDiscordCommandRegistration(
      options.commandRegistration,
    );
    const stream = yield* normalizeDiscordStreamOptions(options.stream);

    return Result.ok({
      token,
      applicationId,
      mode,
      commandRegistration,
      defaultAllowedMentions: options.defaultAllowedMentions ?? createSafeDiscordAllowedMentions(),
      stream,
    });
  });
}

export function parseDiscordApplicationId(
  applicationId: string,
): Result<DiscordApplicationId, DiscordConfigurationError> {
  const trimmed = applicationId.trim();

  return trimmed.length === 0
    ? Result.err(
        new DiscordConfigurationError({
          field: "applicationId",
          reason: "Discord application id must not be empty",
        }),
      )
    : Result.ok(trimmed as DiscordApplicationId);
}

export function parseDiscordBotToken(
  token: string,
): Result<DiscordBotToken, DiscordConfigurationError> {
  const trimmed = token.trim();

  return trimmed.length === 0
    ? Result.err(
        new DiscordConfigurationError({
          field: "token",
          reason: "Discord bot token must not be empty",
        }),
      )
    : Result.ok(trimmed as DiscordBotToken);
}

function normalizeDiscordCommandRegistration(
  registration?: DiscordCommandRegistrationMode,
): Result<DiscordCommandRegistrationMode, DiscordConfigurationError> {
  const resolved = registration ?? defaultDiscordCommandRegistration;

  if (resolved.scope.type === "none") {
    return Result.ok(resolved);
  }

  if (resolved.scope.type === "global") {
    const globalRegistration = resolved as Extract<
      DiscordCommandRegistrationMode,
      { readonly scope: { readonly type: "global" } }
    >;
    return Result.ok({
      ...globalRegistration,
      strategy: globalRegistration.strategy ?? "upsert",
    });
  }

  const guildRegistration = resolved as Extract<
    DiscordCommandRegistrationMode,
    { readonly scope: { readonly type: "guild" } }
  >;
  const guildId = guildRegistration.scope.guildId.trim();
  if (guildId.length === 0) {
    return Result.err(
      new DiscordConfigurationError({
        field: "commandRegistration.scope.guildId",
        reason: "Discord guild command registration requires a non-empty guild id",
      }),
    );
  }

  return Result.ok({
    ...guildRegistration,
    strategy: guildRegistration.strategy ?? "upsert",
    scope: { ...guildRegistration.scope, guildId },
  });
}

function normalizeDiscordStreamOptions(
  stream?: DiscordStreamOptions,
): Result<Required<DiscordStreamOptions>, DiscordConfigurationError> {
  const editIntervalMs = stream?.editIntervalMs ?? defaultDiscordStreamOptions.editIntervalMs;

  if (!Number.isFinite(editIntervalMs) || editIntervalMs <= 0) {
    return Result.err(
      new DiscordConfigurationError({
        field: "stream.editIntervalMs",
        reason: "Discord stream edit interval must be a positive number of milliseconds",
      }),
    );
  }

  return Result.ok({
    placeholderText: stream?.placeholderText ?? defaultDiscordStreamOptions.placeholderText,
    editIntervalMs,
  });
}

function validateDiscordMode(
  mode: DiscordAdapterMode,
): Result<DiscordAdapterMode, DiscordConfigurationError> {
  if (mode.type !== "webhook") {
    return Result.ok(mode);
  }

  const publicKey = mode.publicKey.trim();
  if (publicKey.length === 0) {
    return Result.err(
      new DiscordConfigurationError({
        field: "mode.publicKey",
        reason: "Discord webhook mode requires a non-empty public key",
      }),
    );
  }

  return Result.ok({ ...mode, publicKey });
}
