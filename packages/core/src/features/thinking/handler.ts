import type { ChatActor, ChatConversationRef, ChatTextInput } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Result as BetterResult } from "better-result";
import type { HandlerContext } from "../../ctx";
import { replyToChatEvent, threadFromChatEvent } from "../utils";
import { ThinkingCommandResponseError } from "./errors";
import { formatThinkingFailure, formatThinkingOutput } from "./response";
import { thinkingSessionCommand } from "./service";

export interface HandleThinkingCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: ThinkingCommandEvent;
}

export interface ThinkingCommandEvent<TChatId extends string = string> {
  readonly type: "command";
  readonly chatId: TChatId;
  readonly conversation: ChatConversationRef<TChatId>;
  readonly actor?: ChatActor;
  readonly command: {
    readonly name: "thinking";
    readonly options: {
      readonly level?: string;
    };
  };
  readonly reply: (message: ChatTextInput) => Promise<BetterResult<unknown, unknown>>;
}

/** Handles `/thinking [level|clear]` from any configured chat adapter. */
export async function handleThinkingCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleThinkingCommandInput<TAdapters, TChats>,
): Promise<BetterResult<void, ThinkingCommandResponseError>> {
  const selected = await thinkingSessionCommand({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    level: input.event.command.options.level,
  });

  const response = selected.isOk()
    ? formatThinkingOutput(selected.value)
    : formatThinkingFailure(selected.error);

  return replyToChatEvent({
    event: input.event,
    message: response,
    onError: (cause) => new ThinkingCommandResponseError({ cause }),
  });
}
