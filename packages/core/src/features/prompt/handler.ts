import type {
  ChatActor,
  ChatConversationRef,
  ChatMessage,
  ChatTextInput,
  ChatTextStreamContent,
} from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Result as BetterResult } from "better-result";
import type { HandlerContext } from "../../ctx";
import { replyToChatEvent, streamReplyToChatEvent, threadFromChatEvent } from "../utils";
import { PromptResponseError } from "./errors";
import { formatPromptFailure } from "./response";
import { promptSessionForThread } from "./service";
import { renderPromptEvents } from "./stream";

export interface HandlePromptMessageInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: PromptMessageEvent;
}

export interface PromptMessageEvent<TChatId extends string = string> {
  readonly type: "message";
  readonly chatId: TChatId;
  readonly conversation: ChatConversationRef<TChatId>;
  readonly message: ChatMessage<TChatId>;
  readonly reply: (message: ChatTextInput) => Promise<BetterResult<unknown, unknown>>;
  readonly replyStream: (
    content: ChatTextStreamContent,
    options?: { readonly mode?: "auto" | "thread" | "quote" | "conversation" },
  ) => Promise<BetterResult<unknown, unknown>>;
}

/** Handles normal chat messages as prompts for the active session. */
export async function handlePromptMessage<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandlePromptMessageInput<TAdapters, TChats>,
): Promise<BetterResult<void, PromptResponseError>> {
  const prompted = await promptSessionForThread({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    text: input.event.message.text,
  });

  if (prompted.isErr()) {
    return replyToChatEvent({
      event: input.event,
      message: formatPromptFailure(prompted.error),
      onError: (cause) => new PromptResponseError({ cause }),
    });
  }

  const streamed = await streamReplyToChatEvent({
    event: input.event,
    content: {
      chunks: renderPromptEvents(prompted.value.events),
      format: "markdown",
    },
    onError: (cause) => new PromptResponseError({ cause }),
  });

  if (streamed.isErr()) {
    prompted.value.release();
  }

  return streamed;
}

export function isUserPromptActor(actor: ChatActor): boolean {
  return actor.kind === "user";
}
