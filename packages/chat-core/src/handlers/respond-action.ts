import { Result } from "better-result";
import type { ChatAdapterDefinitions } from "../adapter/registry";
import { ChatActionResponseError, type ChatActionResponseFailure } from "../errors";
import type { GetStartedRuntime } from "./types";
import { createAdapterRespondToActionInput, type RespondToActionInput } from "./adapter-inputs";

export function createRespondToActionHandler<
  TAdapters extends ChatAdapterDefinitions<TAdapters>,
>(args: { readonly getStartedRuntime: GetStartedRuntime<TAdapters> }) {
  return async function respondToAction<
    TInput extends RespondToActionInput<Extract<keyof TAdapters, string>>,
  >(input: TInput): Promise<Result<void, ChatActionResponseFailure>> {
    const runtimeResult = await args.getStartedRuntime({
      chatId: input.chatId,
      operation: "respondToAction",
    });
    if (runtimeResult.isErr()) return Result.err(runtimeResult.error);

    const runtime = runtimeResult.value;
    const adapterInput = createAdapterRespondToActionInput<TAdapters, TInput>(input);

    const response = await Result.tryPromise({
      try: async () => runtime.respondToAction(adapterInput),
      catch: (cause) => new ChatActionResponseError({ chatId: input.chatId, cause }),
    });

    return Result.andThen(response, (adapterResult) =>
      Result.map(
        Result.mapError(
          adapterResult,
          (cause) => new ChatActionResponseError({ chatId: input.chatId, cause }),
        ),
        () => undefined,
      ),
    );
  };
}
