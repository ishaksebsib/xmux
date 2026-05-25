import type { Unsubscribe } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { commandNames } from "../../commands";
import type { Context } from "../../ctx";
import { runXmuxHandler, type XmuxMiddleware } from "../../middleware";
import type { ChatActor } from "@xmux/chat-core";
import { actorFromChatActor, replyToChatEvent, type ChatEventWithReply } from "../utils";
import { UnknownCommandResponseError } from "./errors";
import { formatUnknownCommandResponse } from "./response";

/** Registers chat routes for unknown commands. */
export function registerUnknownCommandRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  ctx: Context<TAdapters, TChats>,
  middleware: readonly XmuxMiddleware<TAdapters, TChats>[] = [],
): Unsubscribe {
  return ctx.chat.on("command.unknown", async (event) => {
    const unknownCommandEvent = event as UnknownCommandEvent;
    const responded = await runXmuxHandler({
      app: ctx,
      event,
      middleware,
      routeName: "unknown-command",
      actor: actorFromChatActor(unknownCommandEvent.actor),
      handler: () =>
        replyToChatEvent({
          event: unknownCommandEvent,
          message: formatUnknownCommandResponse({
            commandName: unknownCommandEvent.commandName,
            availableCommands: commandNames,
          }),
          onError: (cause) => new UnknownCommandResponseError({ cause }),
        }),
    });

    if (responded.isErr()) {
      // TODO: report handler errors through diagnostics/observability.
      return;
    }
  });
}

type UnknownCommandEvent = ChatEventWithReply & {
  readonly commandName: string;
  readonly actor?: ChatActor;
};
