import type { MessageDraftPiece } from "@grammyjs/stream";
import { Result } from "better-result";
import type { ChatAdapterStreamReplyInput, ChatSentMessage } from "@xmux/chat-core";
import type { TelegramBotClient } from "../client";
import {
  encodeTelegramStreamedMessage,
  encodeTelegramStreamReplyMessage,
  parseTelegramPrivateChatId,
} from "../conversions/streaming";
import { TelegramStreamReplyError } from "../errors";
import type { TelegramAdapterData, TelegramAdapterOptions } from "../types";

export async function streamReply<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly bot: TelegramBotClient;
  readonly input: ChatAdapterStreamReplyInput<TChatId, TelegramAdapterOptions>;
}): Promise<Result<ChatSentMessage<TChatId, TelegramAdapterData>, TelegramStreamReplyError>> {
  const chatId = parseTelegramPrivateChatId(args.input.conversationId);
  if (chatId === undefined) {
    return Result.err(
      new TelegramStreamReplyError({
        reason: `Telegram native stream replies require a numeric private chat id: ${args.input.conversationId}`,
      }),
    );
  }

  const request = encodeTelegramStreamReplyMessage(args.input);
  if (request.isErr()) {
    return Result.err(request.error);
  }

  let text = "";
  const streamed = await Result.tryPromise({
    try: async () =>
      args.bot.streamMessage({
        ...request.value,
        chatId,
        stream: captureStreamText(request.value.stream, (nextText) => {
          text = nextText;
        }),
        signal: args.input.signal,
      }),
    catch: (cause) => new TelegramStreamReplyError({ cause }),
  });
  if (streamed.isErr()) {
    return Result.err(streamed.error);
  }

  const sent = Result.try({
    try: () =>
      encodeTelegramStreamedMessage({
        chatId: args.chatId,
        conversationId: args.input.conversationId,
        text,
        format: args.input.content.format,
        telegramMessages: streamed.value,
      }),
    catch: (cause) => new TelegramStreamReplyError({ cause }),
  });
  if (sent.isErr()) {
    return Result.err(sent.error);
  }

  return Result.ok(sent.value);
}

async function* captureStreamText(
  stream: AsyncIterable<MessageDraftPiece>,
  onText: (text: string) => void,
): AsyncIterable<MessageDraftPiece> {
  let text = "";

  for await (const piece of stream) {
    text += typeof piece === "string" ? piece : piece.text;
    onText(text);
    yield piece;
  }
}
