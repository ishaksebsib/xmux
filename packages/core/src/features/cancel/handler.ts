import type { ChatActor, ChatConversationRef, ChatTextInput } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Result as BetterResult } from "better-result";
import type { HandlerContext } from "../../ctx";
import { replyToChatEvent, threadFromChatEvent } from "../utils";
import { CancelCommandResponseError } from "./errors";
import { formatCancelFailure, formatCancelOutput } from "./response";
import { cancelActivePromptForThread } from "./service";

export interface HandleCancelCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: CancelCommandEvent;
}

export interface CancelCommandEvent<TChatId extends string = string> {
  readonly type: "command";
  readonly chatId: TChatId;
  readonly conversation: ChatConversationRef<TChatId>;
  readonly actor?: ChatActor;
  readonly command: {
    readonly name: "cancel";
    readonly options: Record<never, never>;
  };
  readonly reply: (message: ChatTextInput) => Promise<BetterResult<unknown, unknown>>;
}

/** Handles `/cancel` from any configured chat adapter. */
export async function handleCancelCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleCancelCommandInput<TAdapters, TChats>,
): Promise<BetterResult<void, CancelCommandResponseError>> {
  const cancelled = await cancelActivePromptForThread({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
  });

  const response = cancelled.isOk()
    ? formatCancelOutput(cancelled.value)
    : formatCancelFailure(cancelled.error);

  return replyToChatEvent({
    event: input.event,
    message: response,
    onError: (cause) => new CancelCommandResponseError({ cause }),
  });
}
