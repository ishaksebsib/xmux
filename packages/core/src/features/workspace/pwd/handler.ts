import type { ChatActor, ChatConversationRef, ChatTextInput } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Result as BetterResult } from "better-result";
import type { HandlerContext } from "../../../ctx";
import { replyToChatEvent, threadFromChatEvent } from "../../utils";
import { PwdCommandResponseError } from "./errors";
import { formatPwdFailure, formatPwdSuccess } from "./response";
import { getPwdForThread } from "./service";

export interface HandlePwdCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: PwdCommandEvent;
}

export interface PwdCommandEvent<TChatId extends string = string> {
  readonly type: "command";
  readonly chatId: TChatId;
  readonly conversation: ChatConversationRef<TChatId>;
  readonly actor?: ChatActor;
  readonly command: {
    readonly name: "pwd";
    readonly options: Record<never, never>;
  };
  readonly reply: (message: ChatTextInput) => Promise<BetterResult<unknown, unknown>>;
}

/** Handles `/pwd` from any configured chat adapter. */
export async function handlePwdCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandlePwdCommandInput<TAdapters, TChats>,
): Promise<BetterResult<void, PwdCommandResponseError>> {
  const pwd = await getPwdForThread({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
  });

  const response = pwd.isOk() ? formatPwdSuccess(pwd.value) : formatPwdFailure(pwd.error);

  return replyToChatEvent({
    event: input.event,
    message: response,
    onError: (cause) => new PwdCommandResponseError({ cause }),
  });
}
