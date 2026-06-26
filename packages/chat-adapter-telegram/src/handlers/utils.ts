import { Result, type Result as ResultType } from "better-result";
import type { TelegramBotClient } from "../client";
import type { TelegramPlainStreamMessageRequest } from "../conversions/streaming";

export function capturePlainStreamedText<TError>(args: {
  readonly bot: TelegramBotClient;
  readonly request: TelegramPlainStreamMessageRequest;
  readonly signal?: AbortSignal;
  readonly createError: (cause: unknown) => TError;
}): Promise<
  ResultType<
    {
      readonly text: string;
      readonly telegramMessages: Awaited<ReturnType<TelegramBotClient["streamMessage"]>>;
    },
    TError
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
        catch: args.createError,
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
