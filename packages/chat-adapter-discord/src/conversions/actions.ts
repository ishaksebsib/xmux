import { Buffer } from "node:buffer";
import { Result } from "better-result";
import type {
  ChatAdapterRespondToActionInput,
  ChatAdapterSendActionInput,
  ChatActionButtonStyle,
  ChatButton,
  ChatTextInput,
} from "@xmux/chat-core";
import {
  ButtonStyle,
  ComponentType,
  type APIActionRowComponent,
  type APIButtonComponent,
} from "discord-api-types/v10";
import type { APIAllowedMentions } from "discord-api-types/v10";
import type { MessageCreateOptions, MessageEditOptions } from "discord.js";
import type { DiscordSendMessageRequest } from "../client";
import {
  DiscordActionResponseError,
  DiscordInboundDecodeError,
  DiscordSendActionError,
} from "../errors";
import type { DiscordActionEnvelope, DiscordActionStore, DiscordAdapterOptions } from "../types";
import { encodeDiscordMessagePayload, encodeDiscordText } from "./outbound";
import { createDiscordActionStoreKey } from "../stores/action-store";

const customIdPrefix = "xmux:a:";
const actionStorePrefix = "xmux:k:";
const discordCustomIdLimit = 100;
const discordLabelLimit = 80;
const discordUrlLimit = 512;
const discordMaxRows = 5;
const discordMaxButtonsPerRow = 5;
const discordMaxButtonsTotal = 25;

type DiscordActionComponents = NonNullable<MessageCreateOptions["components"]>;
type DiscordSendActionPayload = Omit<DiscordSendMessageRequest, "signal">;

export type DiscordActionResponseRequest =
  | {
      readonly kind: "ack";
      readonly followUp?: MessageCreateOptions;
      readonly signal?: AbortSignal;
    }
  | {
      readonly kind: "reply";
      readonly followUp: MessageCreateOptions;
      readonly signal?: AbortSignal;
    }
  | { readonly kind: "update"; readonly edit: MessageEditOptions; readonly signal?: AbortSignal }
  | { readonly kind: "noop" };

export function encodeDiscordActionCustomIdInline(
  envelope: DiscordActionEnvelope,
): Result<string, DiscordSendActionError> {
  return Result.gen(function* () {
    yield* validateDiscordActionEnvelopeForEncode(envelope);

    const encoded = yield* Result.try({
      try: () =>
        Buffer.from(JSON.stringify(compactDiscordActionEnvelope(envelope)), "utf8").toString(
          "base64url",
        ),
      catch: (cause) => new DiscordSendActionError({ cause }),
    });

    return Result.ok(`${customIdPrefix}${encoded}`);
  });
}

export function isDiscordActionCustomId(customId: string): boolean {
  return customId.startsWith(customIdPrefix) || customId.startsWith(actionStorePrefix);
}

export async function encodeDiscordActionCustomId(args: {
  readonly envelope: DiscordActionEnvelope;
  readonly actionStore?: DiscordActionStore;
  readonly actionStoreTtlMs?: number;
}): Promise<Result<string, DiscordSendActionError>> {
  return Result.gen(async function* () {
    const inline = yield* encodeDiscordActionCustomIdInline(args.envelope);
    if (inline.length <= discordCustomIdLimit) {
      return Result.ok(inline);
    }

    if (args.actionStore === undefined) {
      return Result.err(
        new DiscordSendActionError({
          reason:
            "Discord action payload exceeds the 100-character custom_id limit. Provide actionStore to store oversized button payloads.",
        }),
      );
    }

    const actionStore = args.actionStore;
    const key = createDiscordActionStoreKey();
    const customId = `${actionStorePrefix}${key}`;
    if (customId.length > discordCustomIdLimit) {
      return Result.err(
        new DiscordSendActionError({
          reason: "Discord action store key exceeds the 100-character custom_id limit",
        }),
      );
    }

    yield* Result.await(
      Result.tryPromise({
        try: async () => {
          await actionStore.set(key, args.envelope, { ttlMs: args.actionStoreTtlMs });
        },
        catch: (cause) => new DiscordSendActionError({ cause }),
      }),
    );

    return Result.ok(customId);
  });
}

export async function decodeDiscordActionCustomId(args: {
  readonly customId: string;
  readonly actionStore?: DiscordActionStore;
}): Promise<Result<DiscordActionEnvelope, DiscordInboundDecodeError>> {
  return Result.gen(async function* () {
    if (args.customId.startsWith(customIdPrefix)) {
      const decoded = yield* Result.try({
        try: () =>
          JSON.parse(
            Buffer.from(args.customId.slice(customIdPrefix.length), "base64url").toString("utf8"),
          ) as unknown,
        catch: (cause) => new DiscordInboundDecodeError({ eventType: "interactionCreate", cause }),
      });

      return parseDiscordActionEnvelope(decoded);
    }

    if (!args.customId.startsWith(actionStorePrefix)) {
      return Result.err(
        new DiscordInboundDecodeError({
          eventType: "interactionCreate",
          reason: "Discord button custom_id is not an xmux action payload",
        }),
      );
    }

    if (args.actionStore === undefined) {
      return Result.err(
        new DiscordInboundDecodeError({
          eventType: "interactionCreate",
          reason:
            "Discord button custom_id references action store but no actionStore is configured",
        }),
      );
    }

    const actionStore = args.actionStore;
    const key = args.customId.slice(actionStorePrefix.length);
    if (key.length === 0) {
      return Result.err(
        new DiscordInboundDecodeError({
          eventType: "interactionCreate",
          reason: "Discord button custom_id contains an empty action store key",
        }),
      );
    }

    const stored = yield* Result.await(
      Result.tryPromise({
        try: async () => actionStore.get(key),
        catch: (cause) => new DiscordInboundDecodeError({ eventType: "interactionCreate", cause }),
      }),
    );

    return stored === undefined
      ? Result.err(
          new DiscordInboundDecodeError({
            eventType: "interactionCreate",
            reason: `Discord action payload is missing from actionStore for key ${key}`,
          }),
        )
      : parseDiscordActionEnvelope(stored);
  });
}

export async function encodeDiscordSendAction(
  input: ChatAdapterSendActionInput<string, DiscordAdapterOptions>,
  defaults: {
    readonly allowedMentions: APIAllowedMentions;
    readonly actionStore?: DiscordActionStore;
  },
): Promise<Result<DiscordSendActionPayload, DiscordSendActionError>> {
  return Result.gen(async function* () {
    const content = yield* Result.mapError(
      encodeDiscordText({
        text: input.text,
        format: input.format,
        adapterOptions: input.adapterOptions,
      }),
      (cause) => new DiscordSendActionError({ cause }),
    );

    const components = yield* Result.await(
      encodeDiscordActionComponents({
        buttons: input.buttons,
        actionStore: defaults.actionStore,
        requireButtons: true,
        createError: (reason, cause) => new DiscordSendActionError({ reason, cause }),
      }),
    );

    return Result.ok({
      channelId: input.conversationId,
      payload: {
        ...encodeDiscordMessagePayload({
          content,
          adapterOptions: input.adapterOptions,
          defaults,
        }),
        components,
      },
    });
  });
}

export async function encodeDiscordActionResponse(
  input: ChatAdapterRespondToActionInput<string, DiscordAdapterOptions>,
  defaults: {
    readonly allowedMentions: APIAllowedMentions;
    readonly actionStore?: DiscordActionStore;
  },
): Promise<Result<DiscordActionResponseRequest, DiscordActionResponseError>> {
  return Result.gen(async function* () {
    if (input.response.kind === "ack") {
      if (input.response.showAlert === true) {
        return Result.err(
          new DiscordActionResponseError({
            reason:
              "Discord gateway button actions cannot display alert-style acknowledgements after deferUpdate",
          }),
        );
      }

      if (input.response.text === undefined || input.response.text.length === 0) {
        return Result.ok({
          kind: "ack",
          signal: input.signal,
        } satisfies DiscordActionResponseRequest);
      }

      const content = yield* encodeDiscordActionResponseText({
        message: input.response.text,
        adapterOptions: input.adapterOptions,
      });
      return Result.ok({
        kind: "ack",
        followUp: encodeDiscordMessagePayload({
          content,
          adapterOptions: input.adapterOptions,
          defaults,
        }),
        signal: input.signal,
      } satisfies DiscordActionResponseRequest);
    }

    if (input.response.kind === "reply") {
      const content = yield* encodeDiscordActionResponseText({
        message: input.response.message,
        adapterOptions: input.adapterOptions,
      });
      return Result.ok({
        kind: "reply",
        followUp: encodeDiscordMessagePayload({
          content,
          adapterOptions: input.adapterOptions,
          defaults,
        }),
        signal: input.signal,
      } satisfies DiscordActionResponseRequest);
    }

    if (input.response.message === undefined && input.response.buttons === undefined) {
      return Result.ok({ kind: "noop" } satisfies DiscordActionResponseRequest);
    }

    const content =
      input.response.message === undefined
        ? undefined
        : yield* encodeDiscordActionResponseText({
            message: input.response.message,
            adapterOptions: input.adapterOptions,
          });
    const components =
      input.response.buttons === undefined
        ? undefined
        : yield* Result.await(
            encodeDiscordActionComponents({
              buttons: input.response.buttons,
              actionStore: defaults.actionStore,
              requireButtons: false,
              createError: (reason, cause) => new DiscordActionResponseError({ reason, cause }),
            }),
          );

    return Result.ok({
      kind: "update",
      edit: {
        ...(content === undefined ? {} : { content }),
        ...(components === undefined ? {} : { components }),
        allowedMentions: encodeDiscordMessagePayload({
          content: content ?? "",
          adapterOptions: input.adapterOptions,
          defaults,
        }).allowedMentions,
      },
      signal: input.signal,
    } satisfies DiscordActionResponseRequest);
  });
}

async function encodeDiscordActionComponents<
  TError extends DiscordSendActionError | DiscordActionResponseError,
>(args: {
  readonly buttons: readonly (readonly ChatButton[])[];
  readonly actionStore?: DiscordActionStore;
  readonly requireButtons: boolean;
  readonly createError: (reason: string, cause?: unknown) => TError;
}): Promise<Result<DiscordActionComponents, TError>> {
  return Result.gen(async function* () {
    const valid = validateDiscordButtonRows(args.buttons, args.requireButtons, args.createError);
    yield* valid;

    const rows: APIActionRowComponent<APIButtonComponent>[] = [];
    for (const row of args.buttons) {
      const components: APIButtonComponent[] = [];
      for (const button of row) {
        components.push(
          yield* Result.await(
            encodeDiscordButton({
              button,
              actionStore: args.actionStore,
              createError: args.createError,
            }),
          ),
        );
      }
      rows.push({ type: ComponentType.ActionRow, components });
    }

    return Result.ok(rows as DiscordActionComponents);
  });
}

function validateDiscordButtonRows<TError>(
  rows: readonly (readonly ChatButton[])[],
  requireButtons: boolean,
  createError: (reason: string) => TError,
): Result<void, TError> {
  if (requireButtons && rows.length === 0) {
    return Result.err(createError("Discord action messages require at least one button"));
  }

  if (rows.length > discordMaxRows) {
    return Result.err(
      createError(`Discord action messages support at most ${discordMaxRows} button rows`),
    );
  }

  let total = 0;
  for (const [rowIndex, row] of rows.entries()) {
    if (row.length === 0) {
      return Result.err(createError(`Discord action row ${rowIndex + 1} must not be empty`));
    }

    if (row.length > discordMaxButtonsPerRow) {
      return Result.err(
        createError(
          `Discord action row ${rowIndex + 1} has ${row.length} buttons; maximum is ${discordMaxButtonsPerRow}`,
        ),
      );
    }
    total += row.length;
  }

  return total > discordMaxButtonsTotal
    ? Result.err(
        createError(
          `Discord action messages support at most ${discordMaxButtonsTotal} buttons total`,
        ),
      )
    : Result.ok();
}

async function encodeDiscordButton<
  TError extends DiscordSendActionError | DiscordActionResponseError,
>(args: {
  readonly button: ChatButton;
  readonly actionStore?: DiscordActionStore;
  readonly createError: (reason: string, cause?: unknown) => TError;
}): Promise<Result<APIButtonComponent, TError>> {
  return Result.gen(async function* () {
    const label = args.button.label;
    if (label.trim().length === 0 || label.length > discordLabelLimit) {
      return Result.err(
        args.createError(`Discord button label must be 1-${discordLabelLimit} characters`),
      );
    }

    if (args.button.kind === "url") {
      const url = validateDiscordButtonUrl(args.button.url);
      if (url.isErr()) {
        return Result.err(args.createError(url.error));
      }

      return Result.ok({
        type: ComponentType.Button,
        style: ButtonStyle.Link,
        label,
        url: url.value,
        ...(args.button.disabled === undefined ? {} : { disabled: args.button.disabled }),
      } satisfies APIButtonComponent);
    }

    if (args.button.actionId.trim().length === 0) {
      return Result.err(args.createError("Discord action button actionId must not be empty"));
    }

    if (args.button.value.trim().length === 0) {
      return Result.err(args.createError("Discord action button value must not be empty"));
    }

    const customId = yield* Result.await(
      encodeDiscordActionCustomId({
        envelope: {
          actionId: args.button.actionId,
          value: args.button.value,
          ...(args.button.payload === undefined ? {} : { payload: args.button.payload }),
        },
        actionStore: args.actionStore,
      }).then((result) =>
        Result.mapError(result, (cause) => args.createError(cause.message, cause)),
      ),
    );

    return Result.ok({
      type: ComponentType.Button,
      style: encodeDiscordButtonStyle(args.button.style),
      label,
      custom_id: customId,
      ...(args.button.disabled === undefined ? {} : { disabled: args.button.disabled }),
    } satisfies APIButtonComponent);
  });
}

function validateDiscordButtonUrl(value: string): Result<string, string> {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > discordUrlLimit) {
    return Result.err(`Discord button URL must be 1-${discordUrlLimit} characters`);
  }

  const parsed = Result.try({
    try: () => new URL(trimmed),
    catch: () => undefined,
  });
  if (parsed.isErr()) {
    return Result.err("Discord button URL must be a valid http(s) URL");
  }

  return parsed.value.protocol === "http:" || parsed.value.protocol === "https:"
    ? Result.ok(trimmed)
    : Result.err("Discord button URL must use http or https");
}

function encodeDiscordButtonStyle(
  style: ChatActionButtonStyle | undefined,
): ButtonStyle.Primary | ButtonStyle.Secondary | ButtonStyle.Success | ButtonStyle.Danger {
  switch (style) {
    case "secondary":
      return ButtonStyle.Secondary;
    case "success":
      return ButtonStyle.Success;
    case "danger":
      return ButtonStyle.Danger;
    case "primary":
    case undefined:
      return ButtonStyle.Primary;
  }
}

function encodeDiscordActionResponseText(args: {
  readonly message: ChatTextInput;
  readonly adapterOptions: DiscordAdapterOptions;
}): Result<string, DiscordActionResponseError> {
  const content = typeof args.message === "string" ? { text: args.message } : args.message;
  return Result.mapError(
    encodeDiscordText({
      text: content.text,
      format: content.format,
      adapterOptions: args.adapterOptions,
    }),
    (cause) => new DiscordActionResponseError({ cause }),
  );
}

function validateDiscordActionEnvelopeForEncode(
  envelope: DiscordActionEnvelope,
): Result<void, DiscordSendActionError> {
  if (envelope.actionId.trim().length === 0) {
    return Result.err(new DiscordSendActionError({ reason: "Discord actionId must not be empty" }));
  }

  if (envelope.value.trim().length === 0) {
    return Result.err(
      new DiscordSendActionError({ reason: "Discord action value must not be empty" }),
    );
  }

  return Result.ok();
}

function compactDiscordActionEnvelope(envelope: DiscordActionEnvelope) {
  return {
    a: envelope.actionId,
    v: envelope.value,
    ...(envelope.payload === undefined ? {} : { p: envelope.payload }),
  };
}

function parseDiscordActionEnvelope(
  value: unknown,
): Result<DiscordActionEnvelope, DiscordInboundDecodeError> {
  if (!isRecord(value)) {
    return invalidDiscordActionEnvelope();
  }

  if (typeof value.actionId === "string" && typeof value.value === "string") {
    return normalizeDecodedDiscordActionEnvelope({
      actionId: value.actionId,
      value: value.value,
      ...("payload" in value ? { payload: value.payload } : {}),
    });
  }

  if (typeof value.a === "string" && typeof value.v === "string") {
    return normalizeDecodedDiscordActionEnvelope({
      actionId: value.a,
      value: value.v,
      ...("p" in value ? { payload: value.p } : {}),
    });
  }

  return invalidDiscordActionEnvelope();
}

function normalizeDecodedDiscordActionEnvelope(
  envelope: DiscordActionEnvelope,
): Result<DiscordActionEnvelope, DiscordInboundDecodeError> {
  if (envelope.actionId.trim().length === 0 || envelope.value.trim().length === 0) {
    return invalidDiscordActionEnvelope();
  }

  return Result.ok(envelope);
}

function invalidDiscordActionEnvelope(): Result<DiscordActionEnvelope, DiscordInboundDecodeError> {
  return Result.err(
    new DiscordInboundDecodeError({
      eventType: "interactionCreate",
      reason: "Discord button custom_id did not decode to an action envelope",
    }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
