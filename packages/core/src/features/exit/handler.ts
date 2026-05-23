import type { ChatActor, ChatConversationRef, ChatTextInput } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Result as BetterResult } from "better-result";
import type { HandlerContext } from "../../ctx";
import { replyToChatEvent, threadFromChatEvent } from "../utils";
import { ExitCommandResponseError } from "./errors";
import { formatExitFailure, formatExitOutput } from "./response";
import { exitActiveSessionForThread } from "./service";

export interface HandleExitCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: ExitCommandEvent;
}

export interface ExitCommandEvent<TChatId extends string = string> {
  readonly type: "command";
  readonly chatId: TChatId;
  readonly conversation: ChatConversationRef<TChatId>;
  readonly actor?: ChatActor;
  readonly command: {
    readonly name: "exit";
    readonly options: Record<never, never>;
  };
  readonly reply: (message: ChatTextInput) => Promise<BetterResult<unknown, unknown>>;
}

/** Handles `/exit` from any configured chat adapter. */
export async function handleExitCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleExitCommandInput<TAdapters, TChats>,
): Promise<BetterResult<void, ExitCommandResponseError>> {
  const exited = await exitActiveSessionForThread({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
  });

  const response = exited.isOk() ? formatExitOutput(exited.value) : formatExitFailure(exited.error);

  return replyToChatEvent({
    event: input.event,
    message: response,
    onError: (cause) => new ExitCommandResponseError({ cause }),
  });
}
