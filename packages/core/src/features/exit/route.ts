import type { Unsubscribe } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Context } from "../../ctx";
import { runXmuxHandler, type XmuxMiddleware } from "../../middleware";
import { actorFromChatActor, replyToInvalidCommandUsage, type InvalidCommandEvent } from "../utils";
import { ExitCommandResponseError } from "./errors";
import { handleExitCommand, type ExitCommandEvent } from "./handler";
import { formatExitCommandUsage } from "./response";

/** Registers chat routes owned by the `/exit` feature. */
export function registerExitRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  ctx: Context<TAdapters, TChats>,
  middleware: readonly XmuxMiddleware<TAdapters, TChats>[] = [],
): Unsubscribe {
  const unsubscribeExitCommand = ctx.chat.on("command", "exit", async (event) => {
    const exitCommandEvent = event as ExitCommandEvent<Extract<keyof TChats, string>>;
    const handled = await runXmuxHandler({
      app: ctx,
      event,
      middleware,
      actor: actorFromChatActor(exitCommandEvent.actor),
      handler: (handlerCtx) =>
        handleExitCommand({
          ctx: handlerCtx,
          event: exitCommandEvent,
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

    if (invalidCommandEvent.commandName !== "exit") {
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
          commandName: "exit",
          usage: formatExitCommandUsage(),
          onError: (cause) => new ExitCommandResponseError({ cause }),
        }),
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
