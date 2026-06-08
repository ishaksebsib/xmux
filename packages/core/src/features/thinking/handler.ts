import type { ChatActionEvent, ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { Result } from "better-result";
import type { Actions } from "../../actions";
import type { HandlerContext } from "../../ctx";
import type { ChatThreadRef } from "../../store";
import { CommandResponseError } from "../errors";
import {
  replyWithResult,
  respondToAction,
  toSendActionInput,
  type CommandEvent,
  threadFromChatEvent,
} from "../utils";
import {
  formatThinkingActionMessage,
  formatThinkingFailure,
  formatThinkingOutput,
} from "./response";
import {
  thinkingSessionCommand,
  type ThinkingCommandError,
  type ThinkingCommandOutput,
} from "./service";

export interface HandleThinkingCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: CommandEvent<
    Extract<keyof TChats, string>,
    "thinking",
    { readonly level?: string }
  >;
}

export interface HandleThinkingActionInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: ChatActionEvent<
    Actions,
    "thinking",
    Extract<keyof TChats, string>,
    Result<unknown, unknown>
  >;
}

export async function handleThinkingCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleThinkingCommandInput<TAdapters, TChats>,
): Promise<Result<void, CommandResponseError>> {
  const level = input.event.command.options.level;
  const result = await selectThinking({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    level,
  });

  if (level === undefined && result.isOk()) {
    const message = formatThinkingActionMessage(result.value);

    return respondToAction({
      command: "thinking",
      respond: () =>
        input.ctx.app.chat.sendAction(
          toSendActionInput({ ctx: input.ctx, event: input.event }, message),
        ),
    });
  }

  return replyWithResult({
    event: input.event,
    command: "thinking",
    result,
    ok: formatThinkingOutput,
    err: formatThinkingFailure,
  });
}

export async function handleThinkingAction<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleThinkingActionInput<TAdapters, TChats>,
): Promise<Result<void, CommandResponseError>> {
  const acknowledged = await respondToAction({
    command: "thinking",
    respond: () => input.event.ack(),
  });
  if (acknowledged.isErr()) return acknowledged;

  const result = await selectThinking({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    level: input.event.value,
  });

  return Result.match(result, {
    ok: (value) => {
      const message = formatThinkingActionMessage(value);

      return respondToAction({
        command: "thinking",
        respond: () =>
          input.event.update({
            message: { text: message.text, format: message.format },
            buttons: message.buttons,
          }),
      });
    },
    err: (error) =>
      respondToAction({
        command: "thinking",
        respond: () => input.event.reply(formatThinkingFailure(error)),
      }),
  });
}

function selectThinking<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
  readonly level?: string;
}): Promise<Result<ThinkingCommandOutput, ThinkingCommandError>> {
  return thinkingSessionCommand(input);
}
