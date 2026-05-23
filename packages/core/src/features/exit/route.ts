import type { Unsubscribe } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { createHandlerContext, type Context } from "../../ctx";
import { actorFromChatActor, replyToInvalidCommandUsage, type InvalidCommandEvent } from "../utils";
import { ExitCommandResponseError } from "./errors";
import { handleExitCommand, type ExitCommandEvent } from "./handler";
import { formatExitCommandUsage } from "./response";

/** Registers chat routes owned by the `/exit` feature. */
export function registerExitRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(ctx: Context<TAdapters, TChats>): Unsubscribe {
  const unsubscribeExitCommand = ctx.chat.on("command", "exit", async (event) => {
    const exitCommandEvent = event as ExitCommandEvent<Extract<keyof TChats, string>>;
    const handled = await handleExitCommand({
      ctx: createHandlerContext({
        app: ctx,
        chatId: exitCommandEvent.chatId,
        actor: actorFromChatActor(exitCommandEvent.actor),
      }),
      event: exitCommandEvent,
    });

    if (handled.isErr()) {
      // TODO: report handler errors through diagnostics/observability.
      return;
    }
  });

  const unsubscribeInvalidCommand = ctx.chat.on("command.invalid", async (event) => {
    const responded = await replyToInvalidCommandUsage({
      event: event as InvalidCommandEvent,
      commandName: "exit",
      usage: formatExitCommandUsage(),
      onError: (cause) => new ExitCommandResponseError({ cause }),
    });

    if (responded.isErr()) {
      // TODO: report handler errors through diagnostics/observability.
      return;
    }
  });

  return () => {
    unsubscribeExitCommand();
    unsubscribeInvalidCommand();
  };
}
