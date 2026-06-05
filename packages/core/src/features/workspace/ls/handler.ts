import type { ChatActor, ChatConversationRef, ChatTextInput } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { Result, type Result as BetterResult } from "better-result";
import type { HandlerContext } from "../../../ctx";
import { replyToChatEvent, threadFromChatEvent } from "../../utils";
import { LsCommandResponseError } from "./errors";
import { formatLsFailure, formatLsSuccess } from "./response";
import { listDirectoryForThread } from "./service";

export interface HandleLsCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: LsCommandEvent;
}

export interface LsCommandEvent<TChatId extends string = string> {
  readonly type: "command";
  readonly chatId: TChatId;
  readonly conversation: ChatConversationRef<TChatId>;
  readonly actor?: ChatActor;
  readonly command: {
    readonly name: "ls";
    readonly options: {
      readonly path?: string;
    };
  };
  readonly reply: (message: ChatTextInput) => Promise<BetterResult<unknown, unknown>>;
}

/** Handles `/ls [path]` from any configured chat adapter. */
export async function handleLsCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleLsCommandInput<TAdapters, TChats>,
): Promise<BetterResult<void, LsCommandResponseError>> {
  const listed = await listDirectoryForThread({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    path: input.event.command.options.path,
  });

  const response = Result.match(listed, {
    ok: (value) => formatLsSuccess(value),
    err: (error) => formatLsFailure(error),
  });

  return replyToChatEvent({
    event: input.event,
    message: response,
    onError: (cause) => new LsCommandResponseError({ cause }),
  });
}
