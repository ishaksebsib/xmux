import type { ChatActor, ChatConversationRef, ChatTextInput } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { Result, type Result as BetterResult } from "better-result";
import type { HandlerContext } from "../../ctx";
import { replyToChatEvent, threadFromChatEvent } from "../utils";
import { DeleteCommandResponseError } from "./errors";
import { formatDeleteFailure, formatDeleteOutput } from "./response";
import { deleteSessionCommand } from "./service";

export interface HandleDeleteCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: DeleteCommandEvent;
}

export interface DeleteCommandEvent<TChatId extends string = string> {
  readonly type: "command";
  readonly chatId: TChatId;
  readonly conversation: ChatConversationRef<TChatId>;
  readonly actor?: ChatActor;
  readonly command: {
    readonly name: "delete";
    readonly options: {
      readonly harnessId?: string;
      readonly shortId?: string;
    };
  };
  readonly reply: (message: ChatTextInput) => Promise<BetterResult<unknown, unknown>>;
}

/** Handles `/delete` and `/delete <harnessId> <shortId>` from any configured chat adapter. */
export async function handleDeleteCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleDeleteCommandInput<TAdapters, TChats>,
): Promise<BetterResult<void, DeleteCommandResponseError>> {
  const deleted = await deleteSessionCommand({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    harnessId: input.event.command.options.harnessId,
    shortId: input.event.command.options.shortId,
  });

  const response = Result.match(deleted, {
    ok: (value) => formatDeleteOutput(value),
    err: (error) => formatDeleteFailure(error),
  });

  return replyToChatEvent({
    event: input.event,
    message: response,
    onError: (cause) => new DeleteCommandResponseError({ cause }),
  });
}
