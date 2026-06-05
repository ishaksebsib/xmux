import type { ChatActor, ChatConversationRef, ChatTextInput } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { Result, type Result as BetterResult } from "better-result";
import type { HandlerContext } from "../../ctx";
import { replyToChatEvent, threadFromChatEvent } from "../utils";
import { NewCommandResponseError } from "./errors";
import { createSessionForThread } from "./service";
import { formatNewSessionFailure, formatNewSessionSuccess } from "./response";

export interface HandleNewCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: NewCommandEvent;
}

export interface NewCommandEvent<TChatId extends string = string> {
  readonly type: "command";
  readonly chatId: TChatId;
  readonly conversation: ChatConversationRef<TChatId>;
  readonly actor?: ChatActor;
  readonly command: {
    readonly name: "new";
    readonly options: {
      readonly harnessId: string;
      readonly title?: string;
    };
  };
  readonly reply: (message: ChatTextInput) => Promise<BetterResult<unknown, unknown>>;
}

/** Handles `/new <harnessId> [title]` from any configured chat adapter. */
export async function handleNewCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleNewCommandInput<TAdapters, TChats>,
): Promise<BetterResult<void, NewCommandResponseError>> {
  const created = await createSessionForThread({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    harnessId: input.event.command.options.harnessId,
    title: input.event.command.options.title,
  });

  const response = Result.match(created, {
    ok: (value) => formatNewSessionSuccess(value),
    err: (error) => formatNewSessionFailure(error),
  });

  return replyToChatEvent({
    event: input.event,
    message: response,
    onError: (cause) => new NewCommandResponseError({ cause }),
  });
}
