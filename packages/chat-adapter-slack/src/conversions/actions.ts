import { Buffer } from "node:buffer";
import { Result } from "better-result";
import type {
  ChatActor,
  ChatAdapterActionEvent,
  ChatAdapterRespondToActionInput,
  ChatAdapterSendActionInput,
  ChatActionButtonStyle,
  ChatButton,
  ChatTextInput,
} from "@xmux/chat-core";
import type {
  SlackActionEvent,
  SlackPostEphemeralRequest,
  SlackPostMessageRequest,
  SlackUpdateMessageRequest,
} from "../client";
import { createSlackConversationId, parseSlackConversationId } from "../conversation";
import { SlackActionResponseError, SlackInboundDecodeError, SlackSendActionError } from "../errors";
import {
  createSlackActionInteractionId,
  type SlackActionInteractionContext,
} from "../stores/interaction-registry";
import { createSlackActionStoreKey } from "../stores/action-store";
import type {
  SlackActionEnvelope,
  SlackActionStore,
  SlackAdapterData,
  SlackAdapterOptions,
  SlackBlock,
  SlackConversationScope,
} from "../types";
import { unescapeSlackText, type SlackFormattedText } from "./formatting";
import { encodeSlackMessagePayload, encodeSlackText, slackMarkdownTextLimit } from "./outbound";

const slackActionValuePrefix = "xmux:a:";
const slackActionStorePrefix = "xmux:k:";
const slackButtonValueLimit = 2_000;
const slackButtonLabelLimit = 75;
const slackButtonUrlLimit = 3_000;
const slackBlockTextLimit = 3_000;
const slackActionIdLimit = 255;
const slackMaxRows = 5;
const slackMaxButtonsPerRow = 5;
const slackMaxButtonsTotal = 25;

type SlackSendActionPayload = Omit<SlackPostMessageRequest, "signal">;

export type SlackActionResponseRequest =
  | { readonly kind: "noop" }
  | { readonly kind: "ack"; readonly ephemeral: SlackPostEphemeralRequest }
  | { readonly kind: "reply"; readonly postMessage: SlackPostMessageRequest }
  | { readonly kind: "reply"; readonly postEphemeral: SlackPostEphemeralRequest }
  | { readonly kind: "update"; readonly update: SlackUpdateMessageRequest };

export type SlackActionDecodeResult<TChatId extends string> =
  | {
      readonly status: "event";
      readonly event: ChatAdapterActionEvent<TChatId>;
      readonly context: SlackActionInteractionContext;
    }
  | { readonly status: "ignored"; readonly reason: string };

export function encodeSlackActionValueInline(
  envelope: SlackActionEnvelope,
): Result<string, SlackSendActionError> {
  return Result.gen(function* () {
    yield* validateSlackActionEnvelopeForEncode(envelope);

    const encoded = yield* Result.try({
      try: () =>
        Buffer.from(JSON.stringify(compactSlackActionEnvelope(envelope)), "utf8").toString(
          "base64url",
        ),
      catch: (cause) => new SlackSendActionError({ cause }),
    });

    return Result.ok(`${slackActionValuePrefix}${encoded}`);
  });
}

export function isSlackActionValue(value: string): boolean {
  return value.startsWith(slackActionValuePrefix) || value.startsWith(slackActionStorePrefix);
}

export async function encodeSlackActionValue(args: {
  readonly envelope: SlackActionEnvelope;
  readonly actionStore?: SlackActionStore;
  readonly actionStoreTtlMs?: number;
}): Promise<Result<string, SlackSendActionError>> {
  return Result.gen(async function* () {
    const inline = yield* encodeSlackActionValueInline(args.envelope);
    if (inline.length <= slackButtonValueLimit) {
      return Result.ok(inline);
    }

    if (args.actionStore === undefined) {
      return Result.err(
        new SlackSendActionError({
          reason:
            "Slack action payload exceeds the 2000-character button value limit. Provide actionStore to store oversized button payloads.",
        }),
      );
    }

    const key = createSlackActionStoreKey();
    const value = `${slackActionStorePrefix}${key}`;
    if (value.length > slackButtonValueLimit) {
      return Result.err(
        new SlackSendActionError({
          reason: "Slack action store key exceeds the 2000-character button value limit",
        }),
      );
    }

    const actionStore = args.actionStore;
    yield* Result.await(
      Result.tryPromise({
        try: async () => {
          await actionStore.set(key, args.envelope, { ttlMs: args.actionStoreTtlMs });
        },
        catch: (cause) => new SlackSendActionError({ cause }),
      }),
    );

    return Result.ok(value);
  });
}

export async function decodeSlackActionValue(args: {
  readonly value: string;
  readonly actionStore?: SlackActionStore;
}): Promise<Result<SlackActionEnvelope, SlackInboundDecodeError>> {
  return Result.gen(async function* () {
    if (args.value.startsWith(slackActionValuePrefix)) {
      const decoded = yield* Result.try({
        try: () =>
          JSON.parse(
            Buffer.from(args.value.slice(slackActionValuePrefix.length), "base64url").toString(
              "utf8",
            ),
          ) as unknown,
        catch: (cause) => new SlackInboundDecodeError({ eventType: "block_actions", cause }),
      });

      return parseSlackActionEnvelope(decoded);
    }

    if (!args.value.startsWith(slackActionStorePrefix)) {
      return Result.err(
        new SlackInboundDecodeError({
          eventType: "block_actions",
          reason: "Slack button value is not an xmux action payload",
        }),
      );
    }

    if (args.actionStore === undefined) {
      return Result.err(
        new SlackInboundDecodeError({
          eventType: "block_actions",
          reason: "Slack button value references action store but no actionStore is configured",
        }),
      );
    }

    const key = args.value.slice(slackActionStorePrefix.length);
    if (key.length === 0) {
      return Result.err(
        new SlackInboundDecodeError({
          eventType: "block_actions",
          reason: "Slack button value contains an empty action store key",
        }),
      );
    }

    const actionStore = args.actionStore;
    const stored = yield* Result.await(
      Result.tryPromise({
        try: async () => actionStore.get(key),
        catch: (cause) => new SlackInboundDecodeError({ eventType: "block_actions", cause }),
      }),
    );

    return stored === undefined
      ? Result.err(
          new SlackInboundDecodeError({
            eventType: "block_actions",
            reason: `Slack action payload is missing from actionStore for key ${key}`,
          }),
        )
      : parseSlackActionEnvelope(stored);
  });
}

export async function encodeSlackSendAction(
  input: ChatAdapterSendActionInput<string, SlackAdapterOptions>,
  defaults: { readonly actionStore?: SlackActionStore },
): Promise<Result<SlackSendActionPayload, SlackSendActionError>> {
  return Result.gen(async function* () {
    if (input.adapterOptions.blocks !== undefined) {
      return Result.err(
        new SlackSendActionError({
          reason:
            "Slack sendAction generates Block Kit blocks; adapterOptions.blocks is not supported for action messages",
        }),
      );
    }

    const formatted = yield* Result.mapError(
      encodeSlackText({
        text: input.text,
        format: input.format,
        adapterOptions: input.adapterOptions,
      }),
      (cause) => new SlackSendActionError({ cause }),
    );

    const blocks = yield* Result.await(
      encodeSlackActionBlocks({
        formatted,
        buttons: input.buttons,
        actionStore: defaults.actionStore,
        requireButtons: true,
        createError: (reason, cause) => new SlackSendActionError({ reason, cause }),
      }),
    );

    const target = parseSlackConversationId(input.conversationId);

    return Result.ok({
      channel: target.channelId,
      ...(target.threadTs === undefined ? {} : { thread_ts: target.threadTs }),
      ...sharedSlackMessageOptions(input.adapterOptions),
      text: formatted.text,
      mrkdwn: formatted.mrkdwn,
      blocks,
    });
  });
}

export async function encodeSlackActionResponse(
  input: ChatAdapterRespondToActionInput<string, SlackAdapterOptions>,
  args: {
    readonly interaction: SlackActionInteractionContext;
    readonly actionStore?: SlackActionStore;
  },
): Promise<Result<SlackActionResponseRequest, SlackActionResponseError>> {
  return Result.gen(async function* () {
    if (input.response.kind === "ack") {
      if (input.response.showAlert === true) {
        return Result.err(
          new SlackActionResponseError({
            reason:
              "Slack action acknowledgements cannot display alert-style responses after the transport ack",
          }),
        );
      }

      if (input.response.text === undefined || input.response.text.length === 0) {
        return Result.ok({ kind: "noop" } satisfies SlackActionResponseRequest);
      }

      const formatted = yield* encodeSlackActionResponseText({
        message: input.response.text,
        adapterOptions: input.adapterOptions,
      });

      return Result.ok({
        kind: "ack",
        ephemeral: {
          ...encodeSlackEphemeralResponse({
            channelId: args.interaction.channelId,
            userId: args.interaction.userId,
            threadTs: args.interaction.threadTs,
            formatted,
            adapterOptions: input.adapterOptions,
          }),
          signal: input.signal,
        },
      } satisfies SlackActionResponseRequest);
    }

    if (input.response.kind === "reply") {
      const formatted = yield* encodeSlackActionResponseText({
        message: input.response.message,
        adapterOptions: input.adapterOptions,
      });

      return input.adapterOptions.ephemeral === true
        ? Result.ok({
            kind: "reply",
            postEphemeral: {
              ...encodeSlackEphemeralResponse({
                channelId: args.interaction.channelId,
                userId: args.interaction.userId,
                threadTs: args.interaction.threadTs,
                formatted,
                adapterOptions: input.adapterOptions,
              }),
              signal: input.signal,
            },
          } satisfies SlackActionResponseRequest)
        : Result.ok({
            kind: "reply",
            postMessage: {
              channel: args.interaction.channelId,
              ...encodeSlackMessagePayload({ formatted, adapterOptions: input.adapterOptions }),
              thread_ts: args.interaction.threadTs,
              signal: input.signal,
            },
          } satisfies SlackActionResponseRequest);
    }

    if (input.response.message === undefined && input.response.buttons === undefined) {
      return Result.ok({ kind: "noop" } satisfies SlackActionResponseRequest);
    }

    const formatted =
      input.response.message === undefined
        ? undefined
        : yield* encodeSlackActionResponseText({
            message: input.response.message,
            adapterOptions: input.adapterOptions,
          });

    if (input.response.buttons === undefined) {
      return Result.ok({
        kind: "update",
        update: {
          channel: args.interaction.channelId,
          ts: input.message.messageId,
          ...(formatted === undefined
            ? {}
            : encodeSlackUpdateMessagePayload({
                formatted,
                adapterOptions: input.adapterOptions,
              })),
          signal: input.signal,
        },
      } satisfies SlackActionResponseRequest);
    }

    if (input.adapterOptions.blocks !== undefined) {
      return Result.err(
        new SlackActionResponseError({
          reason:
            "Slack action updates generate Block Kit blocks; adapterOptions.blocks is not supported when buttons are provided",
        }),
      );
    }

    const blocks = yield* Result.await(
      encodeSlackActionBlocks({
        formatted,
        buttons: input.response.buttons,
        actionStore: args.actionStore,
        requireButtons: false,
        createError: (reason, cause) => new SlackActionResponseError({ reason, cause }),
      }),
    );

    return Result.ok({
      kind: "update",
      update: {
        channel: args.interaction.channelId,
        ts: input.message.messageId,
        ...(formatted === undefined ? {} : { text: formatted.text }),
        blocks,
        signal: input.signal,
      },
    } satisfies SlackActionResponseRequest);
  });
}

export async function decodeSlackActionEvent<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly event: SlackActionEvent;
  readonly actionStore?: SlackActionStore;
  readonly conversationScope?: SlackConversationScope;
}): Promise<Result<SlackActionDecodeResult<TChatId>, SlackInboundDecodeError>> {
  return Result.gen(async function* () {
    const action = args.event.action;
    if (!isRecord(action) || action.type !== "button") {
      return Result.ok({ status: "ignored", reason: "unsupported_action" } as const);
    }

    const value = stringAt(action, "value");
    if (value === undefined || !isSlackActionValue(value)) {
      return Result.ok({ status: "ignored", reason: "foreign_button_value" } as const);
    }

    const envelope = yield* Result.await(
      decodeSlackActionValue({ value, actionStore: args.actionStore }),
    );

    const body = args.event.body;
    if (!isRecord(body) || body.type !== "block_actions") {
      return Result.err(
        new SlackInboundDecodeError({
          eventType: "block_actions",
          reason: "Slack action body is not a block_actions payload",
        }),
      );
    }

    const channelId =
      stringAt(recordAt(body, "channel"), "id") ??
      stringAt(recordAt(body, "container"), "channel_id");
    const messageTs =
      stringAt(recordAt(body, "message"), "ts") ??
      stringAt(recordAt(body, "container"), "message_ts");
    const userId = stringAt(recordAt(body, "user"), "id");

    if (channelId === undefined || messageTs === undefined || userId === undefined) {
      return Result.err(
        new SlackInboundDecodeError({
          eventType: "block_actions",
          reason: "Slack action payload is missing channel, message timestamp, or user id",
        }),
      );
    }

    const interactionId = createSlackActionInteractionId(args.event);
    const threadTs = resolveSlackActionThreadTs({ body, messageTs });
    const conversationId = createSlackConversationId({
      conversationScope: args.conversationScope ?? "channel",
      channelId,
      threadTs,
      messageTs,
    });
    const context: SlackActionInteractionContext = {
      interactionId,
      channelId,
      userId,
      messageTs,
      threadTs,
      responseUrl: stringAt(body, "response_url"),
      teamId: stringAt(recordAt(body, "team"), "id"),
      enterpriseId: stringAt(recordAt(body, "enterprise"), "id"),
      triggerId: stringAt(body, "trigger_id"),
      actionTs: stringAt(action, "action_ts"),
      createdAt: Date.now(),
      raw: body,
    };

    const event = {
      type: "action",
      chatId: args.chatId,
      conversation: { chatId: args.chatId, conversationId },
      message: { chatId: args.chatId, conversationId, messageId: messageTs },
      interactionId,
      actor: createSlackActionActor({ body, channelId, userId }),
      actionId: envelope.actionId,
      value: envelope.value,
      ...(envelope.payload === undefined ? {} : { payload: envelope.payload }),
    } as const satisfies ChatAdapterActionEvent<TChatId>;

    return Result.ok({ status: "event", event, context } as const);
  });
}

async function encodeSlackActionBlocks<
  TError extends SlackSendActionError | SlackActionResponseError,
>(args: {
  readonly formatted?: SlackFormattedText;
  readonly buttons: readonly (readonly ChatButton[])[];
  readonly actionStore?: SlackActionStore;
  readonly requireButtons: boolean;
  readonly createError: (reason: string, cause?: unknown) => TError;
}): Promise<Result<readonly SlackBlock[], TError>> {
  return Result.gen(async function* () {
    yield* validateSlackButtonRows(args.buttons, args.requireButtons, args.createError);

    const blocks: SlackBlock[] = [];
    if (args.formatted !== undefined && args.formatted.text.length > 0) {
      if (args.formatted.text.length > slackBlockTextLimit) {
        return Result.err(
          args.createError(
            `Slack Block Kit section text must be at most ${slackBlockTextLimit} characters`,
          ),
        );
      }
      blocks.push({ type: "section", text: encodeSlackBlockText(args.formatted) });
    }

    for (const [rowIndex, row] of args.buttons.entries()) {
      const elements: SlackBlock[] = [];
      for (const button of row) {
        elements.push(
          yield* Result.await(
            encodeSlackButton({
              button,
              actionStore: args.actionStore,
              createError: args.createError,
            }),
          ),
        );
      }
      blocks.push({
        type: "actions",
        block_id: `xmux_actions_${rowIndex + 1}`,
        elements,
      });
    }

    return Result.ok(blocks);
  });
}

function validateSlackButtonRows<TError>(
  rows: readonly (readonly ChatButton[])[],
  requireButtons: boolean,
  createError: (reason: string) => TError,
): Result<void, TError> {
  if (requireButtons && rows.length === 0) {
    return Result.err(createError("Slack action messages require at least one button"));
  }

  if (rows.length > slackMaxRows) {
    return Result.err(
      createError(`Slack action messages support at most ${slackMaxRows} button rows`),
    );
  }

  let total = 0;
  for (const [rowIndex, row] of rows.entries()) {
    if (row.length === 0) {
      return Result.err(createError(`Slack action row ${rowIndex + 1} must not be empty`));
    }

    if (row.length > slackMaxButtonsPerRow) {
      return Result.err(
        createError(
          `Slack action row ${rowIndex + 1} has ${row.length} buttons; maximum is ${slackMaxButtonsPerRow}`,
        ),
      );
    }
    total += row.length;
  }

  return total > slackMaxButtonsTotal
    ? Result.err(
        createError(`Slack action messages support at most ${slackMaxButtonsTotal} buttons total`),
      )
    : Result.ok();
}

async function encodeSlackButton<
  TError extends SlackSendActionError | SlackActionResponseError,
>(args: {
  readonly button: ChatButton;
  readonly actionStore?: SlackActionStore;
  readonly createError: (reason: string, cause?: unknown) => TError;
}): Promise<Result<SlackBlock, TError>> {
  return Result.gen(async function* () {
    const label = args.button.label.trim();
    if (label.length === 0 || label.length > slackButtonLabelLimit) {
      return Result.err(
        args.createError(`Slack button label must be 1-${slackButtonLabelLimit} characters`),
      );
    }

    if (args.button.disabled === true) {
      return Result.err(
        args.createError("Slack Block Kit buttons do not support disabled buttons"),
      );
    }

    const actionId = encodeSlackElementActionId(args.button.id, args.createError);
    if (actionId.isErr()) {
      return Result.err(actionId.error);
    }

    if (args.button.kind === "url") {
      const url = validateSlackButtonUrl(args.button.url);
      if (url.isErr()) {
        return Result.err(args.createError(url.error));
      }

      return Result.ok({
        type: "button",
        action_id: actionId.value,
        text: { type: "plain_text", text: label, emoji: true },
        url: url.value,
      });
    }

    if (args.button.actionId.trim().length === 0) {
      return Result.err(args.createError("Slack action button actionId must not be empty"));
    }

    if (args.button.value.trim().length === 0) {
      return Result.err(args.createError("Slack action button value must not be empty"));
    }

    const value = yield* Result.await(
      encodeSlackActionValue({
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
      type: "button",
      action_id: actionId.value,
      text: { type: "plain_text", text: label, emoji: true },
      value,
      ...encodeSlackButtonStyle(args.button.style),
    });
  });
}

function encodeSlackBlockText(formatted: SlackFormattedText): SlackBlock {
  return formatted.mrkdwn
    ? { type: "mrkdwn", text: formatted.text }
    : { type: "plain_text", text: unescapeSlackText(formatted.text), emoji: true };
}

function encodeSlackButtonStyle(style: ChatActionButtonStyle | undefined): {
  readonly style?: "primary" | "danger";
} {
  switch (style) {
    case "danger":
      return { style: "danger" };
    case "primary":
    case "success":
      return { style: "primary" };
    case "secondary":
    case undefined:
      return {};
  }
}

function encodeSlackElementActionId<TError>(
  id: string,
  createError: (reason: string) => TError,
): Result<string, TError> {
  const trimmed = id.trim();
  if (trimmed.length === 0) {
    return Result.err(createError("Slack button id must not be empty"));
  }

  const actionId = `xmux_${trimmed}`;
  return actionId.length > slackActionIdLimit
    ? Result.err(
        createError(`Slack button action_id must be at most ${slackActionIdLimit} characters`),
      )
    : Result.ok(actionId);
}

function validateSlackButtonUrl(value: string): Result<string, string> {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > slackButtonUrlLimit) {
    return Result.err(`Slack button URL must be 1-${slackButtonUrlLimit} characters`);
  }

  const parsed = Result.try({
    try: () => new URL(trimmed),
    catch: () => undefined,
  });
  if (parsed.isErr()) {
    return Result.err("Slack button URL must be a valid http(s) URL");
  }

  return parsed.value.protocol === "http:" || parsed.value.protocol === "https:"
    ? Result.ok(trimmed)
    : Result.err("Slack button URL must use http or https");
}

function encodeSlackActionResponseText(args: {
  readonly message: ChatTextInput;
  readonly adapterOptions: SlackAdapterOptions;
}): Result<SlackFormattedText, SlackActionResponseError> {
  const content = typeof args.message === "string" ? { text: args.message } : args.message;
  return Result.mapError(
    encodeSlackText({
      text: content.text,
      format: content.format,
      adapterOptions: args.adapterOptions,
    }),
    (cause) => new SlackActionResponseError({ cause }),
  );
}

function encodeSlackEphemeralResponse(args: {
  readonly channelId: string;
  readonly userId: string;
  readonly threadTs?: string;
  readonly formatted: SlackFormattedText;
  readonly adapterOptions: SlackAdapterOptions;
}): SlackPostEphemeralRequest {
  const base = {
    channel: args.channelId,
    user: args.userId,
    ...(args.threadTs === undefined ? {} : { thread_ts: args.threadTs }),
  };

  if (args.adapterOptions.blocks !== undefined) {
    return {
      ...base,
      text: args.formatted.text,
      blocks: args.adapterOptions.blocks,
    };
  }

  if (
    args.formatted.markdown_text !== undefined &&
    args.formatted.markdown_text.length <= slackMarkdownTextLimit
  ) {
    return {
      ...base,
      markdown_text: args.formatted.markdown_text,
    };
  }

  return {
    ...base,
    text: args.formatted.text,
  };
}

function encodeSlackUpdateMessagePayload(args: {
  readonly formatted: SlackFormattedText;
  readonly adapterOptions: SlackAdapterOptions;
}): Omit<SlackUpdateMessageRequest, "channel" | "ts" | "signal"> {
  const shared =
    args.adapterOptions.metadata === undefined ? {} : { metadata: args.adapterOptions.metadata };

  if (args.adapterOptions.blocks !== undefined) {
    return {
      ...shared,
      text: args.formatted.text,
      blocks: args.adapterOptions.blocks,
    };
  }

  if (
    args.formatted.markdown_text !== undefined &&
    args.formatted.markdown_text.length <= slackMarkdownTextLimit
  ) {
    return {
      ...shared,
      markdown_text: args.formatted.markdown_text,
    };
  }

  return {
    ...shared,
    text: args.formatted.text,
  };
}

function resolveSlackActionThreadTs(args: {
  readonly body: Record<string, unknown>;
  readonly messageTs: string;
}): string {
  return (
    stringAt(recordAt(args.body, "message"), "thread_ts") ??
    stringAt(recordAt(args.body, "container"), "thread_ts") ??
    args.messageTs
  );
}

function sharedSlackMessageOptions(adapterOptions: SlackAdapterOptions) {
  return {
    ...(adapterOptions.metadata === undefined ? {} : { metadata: adapterOptions.metadata }),
    ...(adapterOptions.unfurl_links === undefined
      ? {}
      : { unfurl_links: adapterOptions.unfurl_links }),
    ...(adapterOptions.unfurl_media === undefined
      ? {}
      : { unfurl_media: adapterOptions.unfurl_media }),
  };
}

function validateSlackActionEnvelopeForEncode(
  envelope: SlackActionEnvelope,
): Result<void, SlackSendActionError> {
  if (envelope.actionId.trim().length === 0) {
    return Result.err(new SlackSendActionError({ reason: "Slack actionId must not be empty" }));
  }

  if (envelope.value.trim().length === 0) {
    return Result.err(new SlackSendActionError({ reason: "Slack action value must not be empty" }));
  }

  return Result.ok();
}

function compactSlackActionEnvelope(envelope: SlackActionEnvelope) {
  return {
    a: envelope.actionId,
    v: envelope.value,
    ...(envelope.payload === undefined ? {} : { p: envelope.payload }),
  };
}

function parseSlackActionEnvelope(
  value: unknown,
): Result<SlackActionEnvelope, SlackInboundDecodeError> {
  if (!isRecord(value)) {
    return invalidSlackActionEnvelope();
  }

  if (typeof value.actionId === "string" && typeof value.value === "string") {
    return normalizeDecodedSlackActionEnvelope({
      actionId: value.actionId,
      value: value.value,
      ...("payload" in value ? { payload: value.payload } : {}),
    });
  }

  if (typeof value.a === "string" && typeof value.v === "string") {
    return normalizeDecodedSlackActionEnvelope({
      actionId: value.a,
      value: value.v,
      ...("p" in value ? { payload: value.p } : {}),
    });
  }

  return invalidSlackActionEnvelope();
}

function normalizeDecodedSlackActionEnvelope(
  envelope: SlackActionEnvelope,
): Result<SlackActionEnvelope, SlackInboundDecodeError> {
  if (envelope.actionId.trim().length === 0 || envelope.value.trim().length === 0) {
    return invalidSlackActionEnvelope();
  }

  return Result.ok(envelope);
}

function invalidSlackActionEnvelope(): Result<SlackActionEnvelope, SlackInboundDecodeError> {
  return Result.err(
    new SlackInboundDecodeError({
      eventType: "block_actions",
      reason: "Slack button value did not decode to an action envelope",
    }),
  );
}

function createSlackActionActor(args: {
  readonly body: Record<string, unknown>;
  readonly channelId: string;
  readonly userId: string;
}): ChatActor<SlackAdapterData> {
  const user = recordAt(args.body, "user");
  const username = stringAt(user, "username") ?? stringAt(user, "name");

  return {
    kind: "user",
    actorId: args.userId,
    ...(username === undefined ? {} : { displayName: username }),
    adapterData: {
      slackTeamId: stringAt(recordAt(args.body, "team"), "id"),
      slackEnterpriseId: stringAt(recordAt(args.body, "enterprise"), "id"),
      slackChannelId: args.channelId,
      slackUserId: args.userId,
      raw: args.body,
    },
  };
}

function recordAt(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const child = value[key];
  return isRecord(child) ? child : undefined;
}

function stringAt(value: unknown, key: string): string | undefined {
  return isRecord(value) && typeof value[key] === "string" ? value[key] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
