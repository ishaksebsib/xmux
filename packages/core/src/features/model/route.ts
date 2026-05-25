import type { Unsubscribe } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { createHandlerContext, type Context } from "../../ctx";
import { actorFromChatActor, replyToInvalidCommandUsage, type InvalidCommandEvent } from "../utils";
import { ModelCommandResponseError } from "./errors";
import { handleModelCommand, type ModelCommandEvent } from "./handler";
import { formatModelCommandUsage } from "./response";

/** Registers chat routes owned by the `/model` feature. */
export function registerModelRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(ctx: Context<TAdapters, TChats>): Unsubscribe {
  const unsubscribeModelCommand = ctx.chat.on("command", "model", async (event) => {
    const modelCommandEvent = event as ModelCommandEvent<Extract<keyof TChats, string>>;
    const handled = await handleModelCommand({
      ctx: createHandlerContext({
        app: ctx,
        chatId: modelCommandEvent.chatId,
        actor: actorFromChatActor(modelCommandEvent.actor),
      }),
      event: modelCommandEvent,
    });

    if (handled.isErr()) {
      // TODO: report handler errors through diagnostics/observability.
      return;
    }
  });

  const unsubscribeInvalidCommand = ctx.chat.on("command.invalid", async (event) => {
    const responded = await replyToInvalidCommandUsage({
      event: event as InvalidCommandEvent,
      commandName: "model",
      usage: formatModelCommandUsage(),
      onError: (cause) => new ModelCommandResponseError({ cause }),
    });

    if (responded.isErr()) {
      // TODO: report handler errors through diagnostics/observability.
      return;
    }
  });

  return () => {
    unsubscribeModelCommand();
    unsubscribeInvalidCommand();
  };
}
