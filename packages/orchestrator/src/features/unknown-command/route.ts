import type { ChatAdapterDefinitions, Unsubscribe } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { CommandResponseError } from "../errors";
import { dispatch } from "../routing";
import type { ChatActor } from "@xmux/chat-core";
import { commandNames } from "../../commands";
import type { Context } from "../../ctx";
import type { XmuxMiddleware } from "../../middleware";
import { replyToChatEvent, type ChatEventWithReply } from "../utils";
import { formatUnknownCommandResponse } from "./response";

export function registerUnknownCommandRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  ctx: Context<TAdapters, TChats>,
  middleware: readonly XmuxMiddleware<TAdapters, TChats>[] = [],
): Unsubscribe {
  return ctx.chat.on("command.unknown", (raw) => {
    const event = raw as UnknownCommandEvent<Extract<keyof TChats, string>>;
    return dispatch(ctx, middleware, {
      event,
      actor: event.actor,
      routeName: "unknown-command",
      handler: () =>
        replyToChatEvent({
          event,
          message: formatUnknownCommandResponse({
            commandName: event.commandName,
            availableCommands: commandNames,
          }),
          onError: (cause) => new CommandResponseError({ command: event.commandName, cause }),
        }),
    });
  });
}

type UnknownCommandEvent<TChatId extends string = string> = ChatEventWithReply & {
  readonly type: "command.unknown";
  readonly chatId: TChatId;
  readonly conversation: { readonly chatId: TChatId; readonly conversationId: string };
  readonly commandName: string;
  readonly actor?: ChatActor;
};
