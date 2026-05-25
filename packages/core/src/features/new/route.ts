import type { Unsubscribe } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Context } from "../../ctx";
import { runXmuxHandler, type XmuxMiddleware } from "../../middleware";
import { actorFromChatActor, replyToInvalidCommandUsage, type InvalidCommandEvent } from "../utils";
import { NewCommandResponseError } from "./errors";
import { handleNewCommand, type NewCommandEvent } from "./handler";
import { formatNewCommandUsage } from "./response";

/** Registers chat routes owned by the `/new` feature. */
export function registerNewRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  ctx: Context<TAdapters, TChats>,
  middleware: readonly XmuxMiddleware<TAdapters, TChats>[] = [],
): Unsubscribe {
  const unsubscribeNewCommand = ctx.chat.on("command", "new", async (event) => {
    const newCommandEvent = event as NewCommandEvent<Extract<keyof TChats, string>>;
    const handled = await runXmuxHandler({
      app: ctx,
      event,
      middleware,
      actor: actorFromChatActor(newCommandEvent.actor),
      handler: (handlerCtx) =>
        handleNewCommand({
          ctx: handlerCtx,
          event: newCommandEvent,
        }),
    });

    if (handled.isErr()) {
      // TODO: report handler errors through diagnostics/observability.
      return;
    }
  });

  const unsubscribeInvalidCommand = ctx.chat.on("command.invalid", async (event) => {
    const invalidCommandEvent = event as InvalidCommandEvent & {
      readonly actor?: Parameters<typeof actorFromChatActor>[0];
    };

    if (invalidCommandEvent.commandName !== "new") {
      return;
    }

    const responded = await runXmuxHandler({
      app: ctx,
      event,
      middleware,
      actor: actorFromChatActor(invalidCommandEvent.actor),
      handler: () =>
        replyToInvalidCommandUsage({
          event: invalidCommandEvent,
          commandName: "new",
          usage: formatNewCommandUsage(),
          onError: (cause) => new NewCommandResponseError({ cause }),
        }),
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
