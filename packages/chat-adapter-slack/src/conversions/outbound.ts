import { Result } from "better-result";
import type {
  ChatAdapterReplyInput,
  ChatAdapterSendMessageInput,
  ChatSentMessage,
} from "@xmux/chat-core";
import type { SlackPostMessageRequest, SlackSentMessage } from "../client";
import { SlackFormattingError, SlackReplyError, SlackSendMessageError } from "../errors";
import type { SlackAdapterData, SlackAdapterOptions } from "../types";
import { formatSlackText, type SlackFormattedText } from "./formatting";

export const slackTextLimit = 40_000;

type SlackSendMessagePayload = Omit<SlackPostMessageRequest, "signal">;

export function encodeSlackSendMessage(
  input: ChatAdapterSendMessageInput<string, SlackAdapterOptions>,
): Result<SlackSendMessagePayload, SlackSendMessageError> {
  return Result.gen(function* () {
    const formatted = yield* Result.mapError(
      encodeSlackText({
        text: input.text,
        format: input.format,
        adapterOptions: input.adapterOptions,
      }),
      (cause) => new SlackSendMessageError({ cause }),
    );

    return Result.ok({
      channel: input.conversationId,
      ...encodeSlackMessagePayload({ formatted, adapterOptions: input.adapterOptions }),
    });
  });
}

export function encodeSlackReplyMessage(
  input: ChatAdapterReplyInput<string, SlackAdapterOptions>,
): Result<SlackSendMessagePayload, SlackReplyError> {
  return Result.gen(function* () {
    const formatted = yield* Result.mapError(
      encodeSlackText({
        text: input.text,
        format: input.format,
        adapterOptions: input.adapterOptions,
      }),
      (cause) => new SlackReplyError({ cause }),
    );
    const mode = input.mode ?? "auto";
    const messagePayload = encodeSlackMessagePayload({
      formatted,
      adapterOptions: input.adapterOptions,
    });
    const threadTs = resolveSlackReplyThreadTs(input, mode);

    if (threadTs.isErr()) {
      return Result.err(threadTs.error);
    }

    return Result.ok({
      channel: input.conversationId,
      ...messagePayload,
      ...(threadTs.value === undefined ? {} : { thread_ts: threadTs.value }),
      ...(threadTs.value === undefined || input.adapterOptions.replyBroadcast === undefined
        ? {}
        : { reply_broadcast: input.adapterOptions.replyBroadcast }),
    });
  });
}

export function encodeSlackSentMessage<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly text: string;
  readonly format?: ChatAdapterSendMessageInput<TChatId, SlackAdapterOptions>["format"];
  readonly slackMessage: SlackSentMessage;
}): ChatSentMessage<TChatId, SlackAdapterData> {
  return {
    chatId: args.chatId,
    conversationId: args.slackMessage.channelId,
    messageId: args.slackMessage.messageTs,
    text: args.text,
    format: args.format,
    adapterData: {
      slackTeamId: args.slackMessage.teamId,
      slackChannelId: args.slackMessage.channelId,
      slackMessageTs: args.slackMessage.messageTs,
      slackThreadTs: args.slackMessage.threadTs,
      raw: args.slackMessage.raw,
    },
  };
}

export function encodeSlackText(args: {
  readonly text: string;
  readonly format?: "plain" | "markdown" | "html";
  readonly adapterOptions: SlackAdapterOptions;
}): Result<SlackFormattedText, SlackFormattingError> {
  const formatted = formatSlackText(args);

  return Result.andThen(formatted, (content) =>
    content.text.length > slackTextLimit
      ? Result.err(
          new SlackFormattingError({
            format: args.format,
            reason: `Slack message text exceeds ${slackTextLimit} characters`,
          }),
        )
      : Result.ok(content),
  );
}

function encodeSlackMessagePayload(args: {
  readonly formatted: { readonly text: string; readonly mrkdwn: boolean };
  readonly adapterOptions: SlackAdapterOptions;
}): Omit<SlackSendMessagePayload, "channel" | "thread_ts" | "reply_broadcast"> {
  return {
    text: args.formatted.text,
    mrkdwn: args.formatted.mrkdwn,
    ...(args.adapterOptions.blocks === undefined ? {} : { blocks: args.adapterOptions.blocks }),
    ...(args.adapterOptions.metadata === undefined
      ? {}
      : { metadata: args.adapterOptions.metadata }),
    ...(args.adapterOptions.unfurl_links === undefined
      ? {}
      : { unfurl_links: args.adapterOptions.unfurl_links }),
    ...(args.adapterOptions.unfurl_media === undefined
      ? {}
      : { unfurl_media: args.adapterOptions.unfurl_media }),
  };
}

function resolveSlackReplyThreadTs(
  input: ChatAdapterReplyInput<string, SlackAdapterOptions>,
  mode: NonNullable<ChatAdapterReplyInput<string, SlackAdapterOptions>["mode"]>,
): Result<string | undefined, SlackReplyError> {
  if (mode === "conversation") {
    return Result.ok(undefined);
  }

  const messageId = input.message?.messageId.trim();

  if (mode === "thread") {
    return messageId === undefined || messageId.length === 0
      ? Result.err(new SlackReplyError({ reason: "Slack thread replies require a message id" }))
      : Result.ok(messageId);
  }

  if (mode === "quote") {
    return messageId === undefined || messageId.length === 0
      ? Result.err(new SlackReplyError({ reason: "Slack quote replies require a message id" }))
      : Result.ok(messageId);
  }

  return messageId === undefined || messageId.length === 0
    ? Result.ok(undefined)
    : Result.ok(messageId);
}
