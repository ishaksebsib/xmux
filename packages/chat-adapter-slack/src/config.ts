import { Result } from "better-result";
import { SlackConfigurationError } from "./errors";
import type {
  CreateSlackAdapterOptions,
  SlackActionStore,
  SlackAdapterMode,
  SlackCommandMode,
  SlackStreamOptions,
} from "./types";

declare const slackBotTokenBrand: unique symbol;
declare const slackAppTokenBrand: unique symbol;
declare const slackSigningSecretBrand: unique symbol;

export type SlackBotToken = string & { readonly [slackBotTokenBrand]: true };
export type SlackAppToken = string & { readonly [slackAppTokenBrand]: true };
export type SlackSigningSecret = string & { readonly [slackSigningSecretBrand]: true };

export type SlackAdapterConfigMode =
  | {
      readonly type: "socket";
      readonly appToken: SlackAppToken;
    }
  | {
      readonly type: "http";
      readonly signingSecret: SlackSigningSecret;
    };

export interface SlackAdapterConfig {
  readonly botToken: SlackBotToken;
  readonly mode: SlackAdapterConfigMode;
  readonly commandMode: SlackCommandMode;
  readonly actionStore?: SlackActionStore;
  readonly stream: Required<SlackStreamOptions>;
}

export const defaultSlackAdapterMode = {
  type: "socket",
  appToken: "",
} as const satisfies SlackAdapterMode;

export const defaultSlackCommandMode = {
  type: "direct",
} as const satisfies SlackCommandMode;

export const defaultSlackStreamOptions = {
  placeholderText: "…",
  editIntervalMs: 1_500,
} as const satisfies Required<SlackStreamOptions>;

export function normalizeSlackMode(mode?: SlackAdapterMode): SlackAdapterMode {
  return mode ?? defaultSlackAdapterMode;
}

export function parseSlackAdapterConfig<TChatId extends string>(
  options: CreateSlackAdapterOptions<TChatId>,
): Result<SlackAdapterConfig, SlackConfigurationError> {
  return Result.gen(function* () {
    const botToken = yield* parseSlackBotToken(options.botToken);
    const mode = yield* validateSlackMode(normalizeSlackMode(options.mode));
    const commandMode = yield* normalizeSlackCommandMode(options.commandMode);
    const stream = yield* normalizeSlackStreamOptions(options.stream);

    return Result.ok({
      botToken,
      mode,
      commandMode,
      ...(options.actionStore === undefined ? {} : { actionStore: options.actionStore }),
      stream,
    });
  });
}

export function parseSlackBotToken(
  botToken: string | undefined,
): Result<SlackBotToken, SlackConfigurationError> {
  const trimmed = botToken?.trim() ?? "";

  if (trimmed.length === 0) {
    return Result.err(
      new SlackConfigurationError({
        field: "botToken",
        reason: "Slack bot token must not be empty",
      }),
    );
  }

  if (!trimmed.startsWith("xoxb-")) {
    return Result.err(
      new SlackConfigurationError({
        field: "botToken",
        reason: "Slack bot token must start with xoxb-",
      }),
    );
  }

  return Result.ok(trimmed as SlackBotToken);
}

export function parseSlackAppToken(
  appToken: string | undefined,
): Result<SlackAppToken, SlackConfigurationError> {
  const trimmed = appToken?.trim() ?? "";

  if (trimmed.length === 0) {
    return Result.err(
      new SlackConfigurationError({
        field: "mode.appToken",
        reason: "Slack app token must not be empty",
      }),
    );
  }

  if (!trimmed.startsWith("xapp-")) {
    return Result.err(
      new SlackConfigurationError({
        field: "mode.appToken",
        reason: "Slack app token must start with xapp-",
      }),
    );
  }

  return Result.ok(trimmed as SlackAppToken);
}

export function parseSlackSigningSecret(
  signingSecret: string | undefined,
): Result<SlackSigningSecret, SlackConfigurationError> {
  const trimmed = signingSecret?.trim() ?? "";

  return trimmed.length === 0
    ? Result.err(
        new SlackConfigurationError({
          field: "mode.signingSecret",
          reason: "Slack HTTP mode requires a non-empty signing secret",
        }),
      )
    : Result.ok(trimmed as SlackSigningSecret);
}

function validateSlackMode(
  mode: SlackAdapterMode,
): Result<SlackAdapterConfigMode, SlackConfigurationError> {
  if (mode.type === "socket") {
    return Result.map(parseSlackAppToken(mode.appToken), (appToken) => ({
      type: "socket" as const,
      appToken,
    }));
  }

  return Result.map(parseSlackSigningSecret(mode.signingSecret), (signingSecret) => ({
    type: "http" as const,
    signingSecret,
  }));
}

function normalizeSlackCommandMode(
  commandMode?: SlackCommandMode,
): Result<SlackCommandMode, SlackConfigurationError> {
  const resolved = commandMode ?? defaultSlackCommandMode;

  if (resolved.type === "direct") {
    return Result.ok(resolved);
  }

  const command = resolved.command.trim();
  if (command.length === 0) {
    return Result.err(
      new SlackConfigurationError({
        field: "commandMode.command",
        reason: "Slack root command mode requires a non-empty command name",
      }),
    );
  }

  if (!command.startsWith("/")) {
    return Result.err(
      new SlackConfigurationError({
        field: "commandMode.command",
        reason: "Slack root command mode command must start with /",
      }),
    );
  }

  return Result.ok({ ...resolved, command });
}

function normalizeSlackStreamOptions(
  stream?: SlackStreamOptions,
): Result<Required<SlackStreamOptions>, SlackConfigurationError> {
  const editIntervalMs = stream?.editIntervalMs ?? defaultSlackStreamOptions.editIntervalMs;

  if (!Number.isFinite(editIntervalMs) || editIntervalMs <= 0) {
    return Result.err(
      new SlackConfigurationError({
        field: "stream.editIntervalMs",
        reason: "Slack stream edit interval must be a positive number of milliseconds",
      }),
    );
  }

  return Result.ok({
    placeholderText: stream?.placeholderText ?? defaultSlackStreamOptions.placeholderText,
    editIntervalMs,
  });
}
