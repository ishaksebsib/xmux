import type { Unsubscribe } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { createHandlerContext, type Context } from "../../ctx";
import { actorFromChatActor } from "../utils";
import { handleNewCommand, type NewCommandEvent } from "./handler";

/** Registers chat routes owned by the `/new` feature. */
export function registerNewRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(ctx: Context<TAdapters, TChats>): Unsubscribe {
  return ctx.chat.on("command", "new", async (event) => {
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
}
