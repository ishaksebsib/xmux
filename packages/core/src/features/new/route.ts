import type { Unsubscribe } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { createXmuxHandlerContext, type XmuxContext } from "../../ctx";
import { actorFromChatActor } from "../utils";
import { handleNewCommand, type XmuxNewCommandEvent } from "./handler";

/** Registers chat routes owned by the `/new` feature. */
export function registerNewRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(ctx: XmuxContext<TAdapters, TChats>): Unsubscribe {
  return ctx.chat.on("command", "new", async (event) => {
    const newCommandEvent = event as XmuxNewCommandEvent<Extract<keyof TChats, string>>;
    const handled = await handleNewCommand({
      ctx: createXmuxHandlerContext({
        xmux: ctx,
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
