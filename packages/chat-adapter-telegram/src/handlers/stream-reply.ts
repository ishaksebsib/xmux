import { Result } from "better-result";
import type { ChatAdapterStreamReplyInput, ChatSentMessage } from "@xmux/chat-core";
import type { TelegramBotClient } from "../client";
import {
  encodeTelegramStreamedMessage,
  encodeTelegramStreamReplyMessage,
  parseTelegramPrivateChatId,
  type TelegramPlainStreamMessageRequest,
} from "../conversions/streaming";
import { TelegramStreamReplyError } from "../errors";
import { streamTelegramRich } from "./rich-stream";
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

  return Result.gen(async function* () {
    const request = yield* encodeTelegramStreamReplyMessage(args.input);
    const captured =
      request.kind === "rich"
        ? yield* Result.await(
            streamTelegramRich({
              bot: args.bot,
              request,
              signal: args.input.signal,
              createError: (cause) => new TelegramStreamReplyError({ cause }),
            }),
          )
        : yield* Result.await(
            capturePlainStreamedText({
              bot: args.bot,
              request,
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
      catch: (cause) => new TelegramStreamReplyError({ cause }),
    });

    return Result.ok(sent);
  });
}

function capturePlainStreamedText(args: {
  readonly bot: TelegramBotClient;
  readonly request: TelegramPlainStreamMessageRequest;
  readonly signal?: AbortSignal;
}): Promise<
  Result<
    {
      readonly text: string;
      readonly telegramMessages: Awaited<ReturnType<TelegramBotClient["streamMessage"]>>;
    },
    TelegramStreamReplyError
  >
> {
  return Result.gen(async function* () {
    let text = "";
    const telegramMessages = yield* Result.await(
      Result.tryPromise({
        try: async () =>
          args.bot.streamMessage({
            chatId: args.request.chatId,
            draftIdOffset: args.request.draftIdOffset,
            stream: captureStreamText(args.request.stream, (nextText) => {
              text = nextText;
            }),
            draftOptions: args.request.draftOptions,
            messageOptions: args.request.messageOptions,
            signal: args.signal,
          }),
        catch: (cause) => new TelegramStreamReplyError({ cause }),
      }),
    );

    return Result.ok({ text, telegramMessages });
  });
}

async function* captureStreamText(
  stream: AsyncIterable<string>,
  onText: (text: string) => void,
): AsyncIterable<string> {
  let text = "";

  for await (const delta of stream) {
    text += delta;
    onText(text);
    yield delta;
  }
}
