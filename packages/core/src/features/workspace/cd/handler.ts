import type { ChatActor, ChatConversationRef, ChatTextInput } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Result as BetterResult } from "better-result";
import type { HandlerContext } from "../../../ctx";
import { replyToChatEvent, threadFromChatEvent } from "../../utils";
import { CdCommandResponseError } from "./errors";
import { formatCdFailure, formatCdSuccess } from "./response";
import { changeDirectoryForThread } from "./service";

export interface HandleCdCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: CdCommandEvent;
}

export interface CdCommandEvent<TChatId extends string = string> {
  readonly type: "command";
  readonly chatId: TChatId;
  readonly conversation: ChatConversationRef<TChatId>;
  readonly actor?: ChatActor;
  readonly command: {
    readonly name: "cd";
    readonly options: {
      readonly path: string;
    };
  };
  readonly reply: (message: ChatTextInput) => Promise<BetterResult<unknown, unknown>>;
}

/** Handles `/cd <path>` from any configured chat adapter. */
export async function handleCdCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleCdCommandInput<TAdapters, TChats>,
): Promise<BetterResult<void, CdCommandResponseError>> {
  const changed = await changeDirectoryForThread({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    path: input.event.command.options.path,
  });

  const response = changed.isOk() ? formatCdSuccess(changed.value) : formatCdFailure(changed.error);

  return replyToChatEvent({
    event: input.event,
    message: response,
    onError: (cause) => new CdCommandResponseError({ cause }),
  });
}
