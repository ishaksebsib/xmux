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
import { streamTelegramMarkdown } from "./markdown-stream-spooler";

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

  return Result.gen(async function* () {
    const request = encodeTelegramStreamMessage(args.input);
    const useRenderedMarkdown = shouldFinalizeTelegramMarkdownStream({
      format: args.input.content.format,
      adapterOptions: args.input.adapterOptions,
    });
    const captured = useRenderedMarkdown
      ? yield* Result.await(
          streamTelegramMarkdown({
            bot: args.bot,
            request,
            chatId,
            chunks: args.input.content.chunks,
            signal: args.input.signal,
            createError: (cause) => new TelegramStreamMessageError({ cause }),
          }),
        )
      : yield* Result.await(
          captureStreamedText({
            bot: args.bot,
            request,
            chatId,
            signal: args.input.signal,
          }),
        );

    const sent = yield* Result.try({
      try: () =>
        encodeTelegramStreamedMessage({
          chatId: args.chatId,
          conversationId: args.input.conversationId,
          text: captured.text,
          format: args.input.content.format,
          telegramMessages: captured.telegramMessages,
        }),
      catch: (cause) => new TelegramStreamMessageError({ cause }),
    });

    return Result.ok(sent);
  });
}

function captureStreamedText(args: {
  readonly bot: TelegramBotClient;
  readonly request: ReturnType<typeof encodeTelegramStreamMessage>;
  readonly chatId: number;
  readonly signal?: AbortSignal;
}): Promise<
  Result<
    {
      readonly text: string;
      readonly telegramMessages: Awaited<ReturnType<TelegramBotClient["streamMessage"]>>;
    },
    TelegramStreamMessageError
  >
> {
  return Result.gen(async function* () {
    let text = "";
    const telegramMessages = yield* Result.await(
      Result.tryPromise({
        try: async () =>
          args.bot.streamMessage({
            ...args.request,
            chatId: args.chatId,
            stream: captureStreamText(args.request.stream, (nextText) => {
              text = nextText;
            }),
            signal: args.signal,
          }),
        catch: (cause) => new TelegramStreamMessageError({ cause }),
      }),
    );

    return Result.ok({ text, telegramMessages });
  });
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
