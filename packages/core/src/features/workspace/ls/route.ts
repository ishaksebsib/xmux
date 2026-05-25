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
import { LsCommandResponseError } from "./errors";
import { handleLsCommand, type LsCommandEvent } from "./handler";
import { formatLsCommandUsage } from "./response";

/** Registers chat routes owned by the `/ls` feature. */
export function registerLsRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  ctx: Context<TAdapters, TChats>,
  middleware: readonly XmuxMiddleware<TAdapters, TChats>[] = [],
): Unsubscribe {
  const unsubscribeLsCommand = ctx.chat.on("command", "ls", async (event) => {
    const lsCommandEvent = event as LsCommandEvent<Extract<keyof TChats, string>>;
    const handled = await runXmuxHandler({
      app: ctx,
      event,
      middleware,
      actor: actorFromChatActor(lsCommandEvent.actor),
      handler: (handlerCtx) =>
        handleLsCommand({
          ctx: handlerCtx,
          event: lsCommandEvent,
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

    if (invalidCommandEvent.commandName !== "ls") {
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
          commandName: "ls",
          usage: formatLsCommandUsage(),
          onError: (cause) => new LsCommandResponseError({ cause }),
        }),
    });

    if (responded.isErr()) {
      // TODO: report handler errors through diagnostics/observability.
      return;
    }
  });

  return () => {
    unsubscribeLsCommand();
    unsubscribeInvalidCommand();
  };
}
