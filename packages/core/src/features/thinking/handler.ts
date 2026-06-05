import type {
  ChatActionEvent,
  ChatActor,
  ChatAdapterDefinitions,
  ChatConversationRef,
  ChatSendActionInput,
  ChatTextInput,
} from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { Result, type Result as BetterResult } from "better-result";
import type { Actions } from "../../actions";
import type { HandlerContext } from "../../ctx";
import { replyToChatEvent, threadFromChatEvent } from "../utils";
import { ThinkingCommandResponseError } from "./errors";
import {
  formatThinkingActionMessage,
  formatThinkingFailure,
  formatThinkingOutput,
} from "./response";
import { thinkingSessionCommand } from "./service";

export interface HandleThinkingCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: ThinkingCommandEvent<Extract<keyof TChats, string>>;
}

export interface HandleThinkingActionInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: ThinkingActionEvent<Extract<keyof TChats, string>>;
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

export type ThinkingActionEvent<TChatId extends string = string> = ChatActionEvent<
  Actions,
  "thinking",
  TChatId,
  BetterResult<unknown, unknown>
>;

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

  if (
    selected.isOk() &&
    selected.value.status === "shown" &&
    input.event.command.options.level === undefined
  ) {
    return sendThinkingActionMessage({
      ctx: input.ctx,
      event: input.event,
      message: formatThinkingActionMessage(selected.value),
    });
  }

  const response = selected.isOk()
    ? formatThinkingOutput(selected.value)
    : formatThinkingFailure(selected.error);

  return replyToChatEvent({
    event: input.event,
    message: response,
    onError: (cause) => new ThinkingCommandResponseError({ cause }),
  });
}

/** Handles a thinking level button press from a `/thinking` action message. */
export async function handleThinkingAction<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleThinkingActionInput<TAdapters, TChats>,
): Promise<BetterResult<void, ThinkingCommandResponseError>> {
  const acknowledged = await respondToThinkingAction({
    respond: () => input.event.ack(),
    onError: (cause) => new ThinkingCommandResponseError({ cause }),
  });

  if (acknowledged.isErr()) {
    return Result.err(acknowledged.error);
  }

  const selected = await thinkingSessionCommand({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    level: input.event.value,
  });

  if (selected.isErr()) {
    return respondToThinkingAction({
      respond: () => input.event.reply(formatThinkingFailure(selected.error)),
      onError: (cause) => new ThinkingCommandResponseError({ cause }),
    });
  }

  const message = formatThinkingActionMessage(selected.value);

  return respondToThinkingAction({
    respond: () =>
      input.event.update({
        message: { text: message.text, format: message.format },
        buttons: message.buttons,
      }),
    onError: (cause) => new ThinkingCommandResponseError({ cause }),
  });
}

async function sendThinkingActionMessage<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: ThinkingCommandEvent<Extract<keyof TChats, string>>;
  readonly message: ReturnType<typeof formatThinkingActionMessage>;
}): Promise<BetterResult<void, ThinkingCommandResponseError>> {
  const sent = await Result.tryPromise({
    try: () =>
      input.ctx.app.chat.sendAction({
        chatId: input.event.chatId,
        conversationId: input.event.conversation.conversationId,
        text: input.message.text,
        format: input.message.format,
        buttons: input.message.buttons,
        signal: input.ctx.signal,
      } as ChatSendActionInput<TChats, Actions>),
    catch: (cause) => new ThinkingCommandResponseError({ cause }),
  });

  if (sent.isErr()) {
    return Result.err(sent.error);
  }

  if (sent.value.isErr()) {
    return Result.err(new ThinkingCommandResponseError({ cause: sent.value.error }));
  }

  return Result.ok();
}

async function respondToThinkingAction<TError>(input: {
  readonly respond: () => Promise<BetterResult<unknown, unknown>>;
  readonly onError: (cause: unknown) => TError;
}): Promise<BetterResult<void, TError>> {
  const responded = await Result.tryPromise({
    try: input.respond,
    catch: input.onError,
  });

  if (responded.isErr()) {
    return Result.err(responded.error);
  }

  if (responded.value.isErr()) {
    return Result.err(input.onError(responded.value.error));
  }

  return Result.ok();
}
