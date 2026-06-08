import type {
  ChatActionEvent,
  ChatAdapterDefinitions,
  ChatSendActionInput,
  ChatTextInput,
} from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { Result } from "better-result";
import { deleteHarnessActionId, deleteSessionActionId, type Actions } from "../../actions";
import type { HandlerContext } from "../../ctx";
import { CommandResponseError } from "../errors";
import { replyToChatEvent, threadFromChatEvent, type CommandEvent } from "../utils";
import {
  formatDeleteFailure,
  formatDeleteHarnessActionMessage,
  formatDeleteListActionMessage,
  formatDeleteOutput,
  type DeleteActionMessage,
} from "./response";
import {
  deleteSessionCommand,
  listDeleteSessionsForHarness,
  type DeleteCommandError,
  type DeleteCommandOutput,
  type DeleteHarnessesOutput,
  type DeleteListOutput,
} from "./service";

export interface HandleDeleteCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: CommandEvent<
    Extract<keyof TChats, string>,
    "delete",
    { readonly harnessId?: string; readonly shortId?: string }
  >;
}

export interface HandleDeleteHarnessActionInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: ChatActionEvent<
    Actions,
    typeof deleteHarnessActionId,
    Extract<keyof TChats, string>,
    Result<unknown, unknown>
  >;
}

export interface HandleDeleteSessionActionInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: ChatActionEvent<
    Actions,
    typeof deleteSessionActionId,
    Extract<keyof TChats, string>,
    Result<unknown, unknown>
  >;
}

export async function handleDeleteCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: HandleDeleteCommandInput<TAdapters, TChats>): Promise<Result<void, CommandResponseError>> {
  const deleted = await deleteSessionCommand({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    harnessId: input.event.command.options.harnessId,
    shortId: input.event.command.options.shortId,
  });

  if (
    deleted.isOk() &&
    deleted.value.status === "harnesses" &&
    deleted.value.harnessIds.length > 0
  ) {
    return sendDeleteActionMessage({
      ctx: input.ctx,
      event: input.event,
      message: formatDeleteHarnessActionMessage(deleted.value),
    });
  }

  return replyDeleteResult({ event: input.event, result: deleted });
}

export async function handleDeleteHarnessAction<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleDeleteHarnessActionInput<TAdapters, TChats>,
): Promise<Result<void, CommandResponseError>> {
  const acknowledged = await respondToDeleteAction(() => input.event.ack());
  if (acknowledged.isErr()) return acknowledged;

  const listed = await listDeleteSessionsForHarness({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    harnessId: input.event.payload,
  });

  if (listed.isOk() && listed.value.group.sessions.length > 0) {
    return updateDeleteActionMessage({
      event: input.event,
      message: formatDeleteListActionMessage(listed.value),
    });
  }

  return respondToDeleteAction(() => input.event.reply(formatDeleteResult({ result: listed })));
}

export async function handleDeleteSessionAction<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleDeleteSessionActionInput<TAdapters, TChats>,
): Promise<Result<void, CommandResponseError>> {
  const acknowledged = await respondToDeleteAction(() => input.event.ack());
  if (acknowledged.isErr()) return acknowledged;

  const target = parseDeleteSessionActionPayload(input.event.payload);
  const deleted = await deleteSessionCommand({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    harnessId: target.harnessId,
    shortId: target.shortId,
  });

  return respondToDeleteAction(() => input.event.reply(formatDeleteResult({ result: deleted })));
}

function replyDeleteResult(input: {
  readonly event: ChatEventWithReply;
  readonly result: Result<DeleteCommandOutput, DeleteCommandError>;
}): Promise<Result<void, CommandResponseError>> {
  return replyToChatEvent({
    event: input.event,
    message: formatDeleteResult({ result: input.result }),
    onError: (cause) => new CommandResponseError({ command: "delete", cause }),
  });
}

function formatDeleteResult(input: {
  readonly result: Result<DeleteCommandOutput, DeleteCommandError>;
}): ChatTextInput {
  return Result.match(input.result, {
    ok: formatDeleteOutput,
    err: formatDeleteFailure,
  });
}

async function sendDeleteActionMessage<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: CommandEvent<Extract<keyof TChats, string>, "delete">;
  readonly message: DeleteActionMessage;
}): Promise<Result<void, CommandResponseError>> {
  const sent = await input.ctx.app.chat.sendAction(toSendActionInput(input, input.message));

  return Result.map(
    Result.mapError(sent, (cause) => new CommandResponseError({ command: "delete", cause })),
    () => undefined,
  );
}

function toSendActionInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: {
    readonly ctx: HandlerContext<TAdapters, TChats>;
    readonly event: CommandEvent<Extract<keyof TChats, string>, "delete">;
  },
  message: DeleteActionMessage,
): ChatSendActionInput<TChats, Actions> {
  return {
    chatId: input.event.chatId,
    conversationId: input.event.conversation.conversationId,
    text: message.text,
    format: message.format,
    buttons: message.buttons,
    signal: input.ctx.signal,
  } as ChatSendActionInput<TChats, Actions>;
}

function updateDeleteActionMessage(input: {
  readonly event: ChatActionEvent<
    Actions,
    typeof deleteHarnessActionId,
    string,
    Result<unknown, unknown>
  >;
  readonly message: DeleteActionMessage;
}): Promise<Result<void, CommandResponseError>> {
  return respondToDeleteAction(() =>
    input.event.update({
      message: {
        text: input.message.text,
        format: input.message.format,
      },
      buttons: input.message.buttons,
    }),
  );
}

async function respondToDeleteAction(
  respond: () => Promise<Result<unknown, unknown>>,
): Promise<Result<void, CommandResponseError>> {
  const responded = await respond();

  return Result.map(
    Result.mapError(responded, (cause) => new CommandResponseError({ command: "delete", cause })),
    () => undefined,
  );
}

function parseDeleteSessionActionPayload(payload: string): {
  readonly harnessId: string;
  readonly shortId: string;
} {
  const separatorIndex = payload.indexOf(":");
  if (separatorIndex < 1) {
    return { harnessId: "", shortId: "" };
  }

  return {
    harnessId: payload.slice(0, separatorIndex),
    shortId: payload.slice(separatorIndex + 1),
  };
}

type ChatEventWithReply = {
  readonly reply: (message: ChatTextInput) => Promise<Result<unknown, unknown>>;
};
