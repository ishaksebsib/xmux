import type { ChatActor, ChatConversationRef, ChatTextInput } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { Result, type Result as BetterResult } from "better-result";
import type { HandlerContext } from "../../ctx";
import { replyToChatEvent, threadFromChatEvent } from "../utils";
import { InteractionCommandResponseError } from "./errors";
import { formatInteractionFailure, formatInteractionOutput } from "./response";
import {
  respondToCurrentInteractionForThread,
  type InteractionCommandAction,
  type RespondToCurrentInteractionOutput,
} from "./service";

export interface HandleInteractionCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: InteractionCommandEvent;
  readonly action: InteractionCommandAction;
}

export type InteractionCommandEvent<TChatId extends string = string> =
  | AllowCommandEvent<TChatId>
  | RejectCommandEvent<TChatId>;

export interface AllowCommandEvent<TChatId extends string = string> {
  readonly type: "command";
  readonly chatId: TChatId;
  readonly conversation: ChatConversationRef<TChatId>;
  readonly actor?: ChatActor;
  readonly command: {
    readonly name: "allow";
    readonly options: {
      readonly mode?: "always";
    };
  };
  readonly reply: (message: ChatTextInput) => Promise<BetterResult<unknown, unknown>>;
}

function isSilentAllowResponse(output: RespondToCurrentInteractionOutput): boolean {
  return (
    output.status === "responded" &&
    (output.action === "allowed_once" || output.action === "allowed_always")
  );
}

export interface RejectCommandEvent<TChatId extends string = string> {
  readonly type: "command";
  readonly chatId: TChatId;
  readonly conversation: ChatConversationRef<TChatId>;
  readonly actor?: ChatActor;
  readonly command: {
    readonly name: "reject";
    readonly options: Record<never, never>;
  };
  readonly reply: (message: ChatTextInput) => Promise<BetterResult<unknown, unknown>>;
}

/** Handles `/allow`, `/allow always`, and `/reject` from any configured chat adapter. */
export async function handleInteractionCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleInteractionCommandInput<TAdapters, TChats>,
): Promise<BetterResult<void, InteractionCommandResponseError>> {
  const responded = await respondToCurrentInteractionForThread({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    action: input.action,
  });

  if (responded.isOk() && isSilentAllowResponse(responded.value)) {
    return Result.ok();
  }

  const response = responded.isOk()
    ? formatInteractionOutput(responded.value)
    : formatInteractionFailure(responded.error);

  return replyToChatEvent({
    event: input.event,
    message: response,
    onError: (cause) => new InteractionCommandResponseError({ cause }),
  });
}
