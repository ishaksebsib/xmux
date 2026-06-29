import type { ChatActionEvent, ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { Result } from "better-result";
import { menuActionId, type Actions } from "../../actions";
import type { HandlerContext } from "../../ctx";
import { CommandResponseError } from "../errors";
import {
  replyToChatEvent,
  respondToAction,
  threadFromChatEvent,
  toSendActionInput,
  updateActionMessage,
  type CommandEvent,
} from "../utils";
import { parseMenuItemId } from "./id";
import { visibleMenuItems } from "./registry";
import { formatMenuActionMessage, formatMenuFailure } from "./response";
import { resolveMenuState, type MenuState } from "./state";

export interface HandleMenuCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: CommandEvent<Extract<keyof TChats, string>, "menu">;
}

export interface HandleMenuActionInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: ChatActionEvent<
    Actions,
    typeof menuActionId,
    Extract<keyof TChats, string>,
    Result<unknown, unknown>
  >;
}

export async function handleMenuCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: HandleMenuCommandInput<TAdapters, TChats>): Promise<Result<void, CommandResponseError>> {
  const state = await resolveMenuState({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
  });

  if (state.isErr()) {
    return replyToChatEvent({
      event: input.event,
      message: formatMenuFailure(state.error),
      onError: (cause) => new CommandResponseError({ command: "menu", cause }),
    });
  }

  const message = formatCurrentMenu({ ctx: input.ctx, state: state.value });

  return respondToAction({
    command: "menu",
    respond: () =>
      input.ctx.app.chat.sendAction(
        toSendActionInput({ ctx: input.ctx, event: input.event }, message),
      ),
  });
}

export async function handleMenuAction<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: HandleMenuActionInput<TAdapters, TChats>): Promise<Result<void, CommandResponseError>> {
  const acknowledged = await respondToAction({
    command: "menu",
    respond: () => input.event.ack(),
  });
  if (acknowledged.isErr()) return acknowledged;

  const parsedId = parseMenuItemId(input.event.payload);
  const state = await resolveMenuState({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
  });

  if (state.isErr()) {
    return respondToAction({
      command: "menu",
      respond: () => input.event.reply(formatMenuFailure(state.error)),
    });
  }

  if (parsedId.isErr()) {
    return refreshMenu(input, state.value, "That menu action is no longer available.");
  }

  const item = input.ctx.app.services.menu.get(parsedId.value);
  if (item.isErr() || !item.value.visible(state.value)) {
    return refreshMenu(
      input,
      state.value,
      "Menu refreshed because that action is no longer valid.",
    );
  }

  const injected = await input.ctx.app.chat.injectCommand({
    chatId: input.event.chatId,
    conversationId: input.event.conversation.conversationId,
    messageId: input.event.message.messageId,
    actor: input.event.actor,
    command: item.value.command({ state: state.value }),
  });

  return Result.mapError(injected, (cause) => new CommandResponseError({ command: "menu", cause }));
}

function refreshMenu<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleMenuActionInput<TAdapters, TChats>,
  state: MenuState,
  notice: string,
): Promise<Result<void, CommandResponseError>> {
  return updateActionMessage({
    command: "menu",
    event: input.event,
    message: formatCurrentMenu({ ctx: input.ctx, state, notice }),
  });
}

function formatCurrentMenu<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly state: MenuState;
  readonly notice?: string;
}) {
  return formatMenuActionMessage({
    state: input.state,
    items: visibleMenuItems({ registry: input.ctx.app.services.menu, state: input.state }),
    ...(input.notice === undefined ? {} : { notice: input.notice }),
  });
}
