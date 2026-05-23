import type { Unsubscribe } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { createHandlerContext, type Context } from "../../ctx";
import { actorFromChatActor, replyToInvalidCommandUsage, type InvalidCommandEvent } from "../utils";
import { DeleteCommandResponseError } from "./errors";
import { handleDeleteCommand, type DeleteCommandEvent } from "./handler";
import { formatDeleteCommandUsage } from "./response";

/** Registers chat routes owned by the `/delete` feature. */
export function registerDeleteRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(ctx: Context<TAdapters, TChats>): Unsubscribe {
  const unsubscribeDeleteCommand = ctx.chat.on("command", "delete", async (event) => {
    const deleteCommandEvent = event as DeleteCommandEvent<Extract<keyof TChats, string>>;
    const handled = await handleDeleteCommand({
      ctx: createHandlerContext({
        app: ctx,
        chatId: deleteCommandEvent.chatId,
        actor: actorFromChatActor(deleteCommandEvent.actor),
      }),
      event: deleteCommandEvent,
    });

    if (handled.isErr()) {
      // TODO: report handler errors through diagnostics/observability.
      return;
    }
  });

  const unsubscribeInvalidCommand = ctx.chat.on("command.invalid", async (event) => {
    const responded = await replyToInvalidCommandUsage({
      event: event as InvalidCommandEvent,
      commandName: "delete",
      usage: formatDeleteCommandUsage(),
      onError: (cause) => new DeleteCommandResponseError({ cause }),
    });

    if (responded.isErr()) {
      // TODO: report handler errors through diagnostics/observability.
      return;
    }
  });

  return () => {
    unsubscribeDeleteCommand();
    unsubscribeInvalidCommand();
  };
}
