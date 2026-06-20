import { Result } from "better-result";
import type {
  ChatAdapterReplyInput,
  ChatAdapterSendMessageInput,
  ChatSentMessage,
} from "@xmux/chat-core";
import type { SlackPostMessageRequest, SlackSentMessage } from "../client";
import { slackMarkdownTextLimit, slackTextLimit } from "../constants";
import { parseSlackConversationId } from "../conversation";
import { SlackFormattingError, SlackReplyError, SlackSendMessageError } from "../errors";
import type { SlackAdapterData, SlackAdapterOptions } from "../types";
import { formatSlackText, type SlackFormattedText } from "./formatting";

export { slackMarkdownTextLimit, slackTextLimit } from "../constants";

export type SlackSendMessagePayload = Omit<SlackPostMessageRequest, "signal">;

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

    const target = parseSlackConversationId(input.conversationId);

    return Result.ok({
      channel: target.channelId,
      ...(target.threadTs === undefined ? {} : { thread_ts: target.threadTs }),
      ...encodeSlackMessagePayload({ formatted, adapterOptions: input.adapterOptions }),
      ...(target.threadTs === undefined || input.adapterOptions.replyBroadcast === undefined
        ? {}
        : { reply_broadcast: input.adapterOptions.replyBroadcast }),
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
    const target = parseSlackConversationId(input.conversationId);
    const threadTs = resolveSlackReplyThreadTs(input, mode, target.threadTs);

    if (threadTs.isErr()) {
      return Result.err(threadTs.error);
    }

    return Result.ok({
      channel: target.channelId,
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
  readonly conversationId?: string;
  readonly slackMessage: SlackSentMessage;
}): ChatSentMessage<TChatId, SlackAdapterData> {
  return {
    chatId: args.chatId,
    conversationId: args.conversationId ?? args.slackMessage.channelId,
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

  return Result.andThen(formatted, (content) => {
    const willUseNativeMarkdown = shouldUseNativeMarkdown({
      formatted: content,
      adapterOptions: args.adapterOptions,
    });

    if (!willUseNativeMarkdown && content.text.length > slackTextLimit) {
      return Result.err(
        new SlackFormattingError({
          format: args.format,
          reason: `Slack message text exceeds ${slackTextLimit} characters`,
        }),
      );
    }

    return Result.ok(content);
  });
}

export function encodeSlackMessagePayload(args: {
  readonly formatted: SlackFormattedText;
  readonly adapterOptions: SlackAdapterOptions;
}): Omit<SlackSendMessagePayload, "channel" | "thread_ts" | "reply_broadcast"> {
  const shared = {
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

  if (shouldUseNativeMarkdown(args)) {
    return {
      ...shared,
      markdown_text: args.formatted.markdown_text,
    };
  }

  return {
    ...shared,
    text: args.formatted.text,
    mrkdwn: args.formatted.mrkdwn,
    ...(args.adapterOptions.blocks === undefined ? {} : { blocks: args.adapterOptions.blocks }),
  };
}

function shouldUseNativeMarkdown(args: {
  readonly formatted: SlackFormattedText;
  readonly adapterOptions: SlackAdapterOptions;
}): args is {
  readonly formatted: SlackFormattedText & { readonly markdown_text: string };
  readonly adapterOptions: SlackAdapterOptions;
} {
  return (
    args.formatted.markdown_text !== undefined &&
    args.formatted.markdown_text.length <= slackMarkdownTextLimit &&
    args.adapterOptions.blocks === undefined
  );
}

function resolveSlackReplyThreadTs(
  input: ChatAdapterReplyInput<string, SlackAdapterOptions>,
  mode: NonNullable<ChatAdapterReplyInput<string, SlackAdapterOptions>["mode"]>,
  conversationThreadTs: string | undefined,
): Result<string | undefined, SlackReplyError> {
  if (mode === "conversation") {
    return Result.ok(conversationThreadTs);
  }

  const messageId = input.message?.messageId.trim();

  if (mode === "thread") {
    if (conversationThreadTs !== undefined) return Result.ok(conversationThreadTs);

    return messageId === undefined || messageId.length === 0
      ? Result.err(new SlackReplyError({ reason: "Slack thread replies require a message id" }))
      : Result.ok(messageId);
  }

  if (mode === "quote") {
    if (conversationThreadTs !== undefined) return Result.ok(conversationThreadTs);

    return messageId === undefined || messageId.length === 0
      ? Result.err(new SlackReplyError({ reason: "Slack quote replies require a message id" }))
      : Result.ok(messageId);
  }

  if (conversationThreadTs !== undefined) return Result.ok(conversationThreadTs);

  return messageId === undefined || messageId.length === 0
    ? Result.ok(undefined)
    : Result.ok(messageId);
}
