import type { Unsubscribe } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Context } from "../../../ctx";
import { runXmuxHandler, type XmuxMiddleware } from "../../../middleware";
import {
  actorFromChatActor,
  replyToInvalidCommandUsage,
  type InvalidCommandEvent,
} from "../../utils";
import { CdCommandResponseError } from "./errors";
import { handleCdCommand, type CdCommandEvent } from "./handler";
import { formatCdCommandUsage } from "./response";

/** Registers chat routes owned by the `/cd` feature. */
export function registerCdRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  ctx: Context<TAdapters, TChats>,
  middleware: readonly XmuxMiddleware<TAdapters, TChats>[] = [],
): Unsubscribe {
  const unsubscribeCdCommand = ctx.chat.on("command", "cd", async (event) => {
    const cdCommandEvent = event as CdCommandEvent<Extract<keyof TChats, string>>;
    const handled = await runXmuxHandler({
      app: ctx,
      event,
      middleware,
      actor: actorFromChatActor(cdCommandEvent.actor),
      handler: (handlerCtx) =>
        handleCdCommand({
          ctx: handlerCtx,
          event: cdCommandEvent,
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

    if (invalidCommandEvent.commandName !== "cd") {
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
          commandName: "cd",
          usage: formatCdCommandUsage(),
          onError: (cause) => new CdCommandResponseError({ cause }),
        }),
    });

    if (responded.isErr()) {
      // TODO: report handler errors through diagnostics/observability.
      return;
    }
  });

  return () => {
    unsubscribeCdCommand();
    unsubscribeInvalidCommand();
  };
}
