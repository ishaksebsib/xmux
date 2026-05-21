import type { Unsubscribe } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { createHandlerContext, type Context } from "../../ctx";
import { actorFromChatActor, replyToInvalidCommandUsage, type InvalidCommandEvent } from "../utils";
import { NewCommandResponseError } from "./errors";
import { handleNewCommand, type NewCommandEvent } from "./handler";
import { formatNewCommandUsage } from "./response";

/** Registers chat routes owned by the `/new` feature. */
export function registerNewRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(ctx: Context<TAdapters, TChats>): Unsubscribe {
  const unsubscribeNewCommand = ctx.chat.on("command", "new", async (event) => {
    const newCommandEvent = event as NewCommandEvent<Extract<keyof TChats, string>>;
    const handled = await handleNewCommand({
      ctx: createHandlerContext({
        app: ctx,
        chatId: newCommandEvent.chatId,
        actor: actorFromChatActor(newCommandEvent.actor),
      }),
      event: newCommandEvent,
    });

    if (handled.isErr()) {
      // TODO: report handler errors through diagnostics/observability.
      return;
    }
  });

  const unsubscribeInvalidCommand = ctx.chat.on("command.invalid", async (event) => {
    const responded = await replyToInvalidCommandUsage({
      event: event as InvalidCommandEvent,
      commandName: "new",
      usage: formatNewCommandUsage(),
      onError: (cause) => new NewCommandResponseError({ cause }),
    });

    if (responded.isErr()) {
      // TODO: report handler errors through diagnostics/observability.
      return;
    }
  });

  return () => {
    unsubscribeNewCommand();
    unsubscribeInvalidCommand();
  };
}
