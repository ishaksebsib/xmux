import type { Unsubscribe } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { createHandlerContext, type Context } from "../../ctx";
import { actorFromChatActor } from "../utils";
import { handlePromptMessage, isUserPromptActor, type PromptMessageEvent } from "./handler";

/** Registers chat routes owned by the prompt feature. */
export function registerPromptRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(ctx: Context<TAdapters, TChats>): Unsubscribe {
  return ctx.chat.on("message", async (event) => {
    const promptEvent = event as PromptMessageEvent<Extract<keyof TChats, string>>;

    if (!isUserPromptActor(promptEvent.message.actor)) {
      return;
    }

    if (promptEvent.message.text.trim().length === 0) {
      return;
    }

    const handled = await handlePromptMessage({
      ctx: createHandlerContext({
        app: ctx,
        chatId: promptEvent.chatId,
        actor: actorFromChatActor(promptEvent.message.actor),
      }),
      event: promptEvent,
    });

    if (handled.isErr()) {
      // TODO: report handler errors through diagnostics/observability.
      return;
    }
  });
}
