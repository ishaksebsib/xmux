import { Result } from "better-result";
import type { ChatAdapterStreamMessageInput, ChatSentMessage } from "@xmux/chat-core";
import type { MessageDraftPiece } from "@grammyjs/stream";
import type { TelegramBotClient } from "../client";
import {
  encodeTelegramStreamedMessage,
  encodeTelegramStreamMessage,
  parseTelegramPrivateChatId,
  shouldFinalizeTelegramMarkdownStream,
} from "../conversions/streaming";
import { TelegramStreamMessageError } from "../errors";
import type { TelegramAdapterData, TelegramAdapterOptions } from "../types";
import { finalizeMarkdownStream } from "./finalize-markdown-stream";

export async function streamMessage<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly bot: TelegramBotClient;
  readonly input: ChatAdapterStreamMessageInput<TChatId, TelegramAdapterOptions>;
}): Promise<Result<ChatSentMessage<TChatId, TelegramAdapterData>, TelegramStreamMessageError>> {
  const chatId = parseTelegramPrivateChatId(args.input.conversationId);
  if (chatId === undefined) {
    return Result.err(
      new TelegramStreamMessageError({
        reason: `Telegram native streaming requires a numeric private chat id: ${args.input.conversationId}`,
      }),
    );
  }

  const request = encodeTelegramStreamMessage(args.input);
  let text = "";
  const streamed = await Result.tryPromise({
    try: async () =>
      args.bot.streamMessage({
        ...request,
        chatId,
        stream: captureStreamText(request.stream, (nextText) => {
          text = nextText;
        }),
        signal: args.input.signal,
      }),
    catch: (cause) => new TelegramStreamMessageError({ cause }),
  });
  if (streamed.isErr()) {
    return Result.err(streamed.error);
  }

  if (
    shouldFinalizeTelegramMarkdownStream({
      format: args.input.content.format,
      adapterOptions: args.input.adapterOptions,
    })
  ) {
    const finalized = await finalizeMarkdownStream({
      bot: args.bot,
      telegramMessages: streamed.value,
      signal: args.input.signal,
      createError: (cause) => new TelegramStreamMessageError({ cause }),
    });
    if (finalized.isErr()) {
      return Result.err(finalized.error);
    }
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
    catch: (cause) => new TelegramStreamMessageError({ cause }),
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
