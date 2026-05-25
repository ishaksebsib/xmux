import type { ChatActor, ChatConversationRef, ChatTextInput } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Result as BetterResult } from "better-result";
import type { HandlerContext } from "../../ctx";
import { replyToChatEvent, threadFromChatEvent } from "../utils";
import { ModelCommandResponseError } from "./errors";
import { formatModelFailure, formatModelOutput } from "./response";
import { modelSessionCommand } from "./service";

export interface HandleModelCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: ModelCommandEvent;
}

export interface ModelCommandEvent<TChatId extends string = string> {
  readonly type: "command";
  readonly chatId: TChatId;
  readonly conversation: ChatConversationRef<TChatId>;
  readonly actor?: ChatActor;
  readonly command: {
    readonly name: "model";
    readonly options: {
      readonly selector?: string;
    };
  };
  readonly reply: (message: ChatTextInput) => Promise<BetterResult<unknown, unknown>>;
}

/** Handles `/model [providerId/modelId]` from any configured chat adapter. */
export async function handleModelCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleModelCommandInput<TAdapters, TChats>,
): Promise<BetterResult<void, ModelCommandResponseError>> {
  const selected = await modelSessionCommand({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    selector: input.event.command.options.selector,
  });

  const response = selected.isOk()
    ? formatModelOutput(selected.value)
    : formatModelFailure(selected.error, {
        maxSuggestions: input.ctx.app.config.model.maxModelsPerProvider,
      });

  return replyToChatEvent({
    event: input.event,
    message: response,
    onError: (cause) => new ModelCommandResponseError({ cause }),
  });
}
