import type { Unsubscribe } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { createHandlerContext, type Context } from "../../../ctx";
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
>(ctx: Context<TAdapters, TChats>): Unsubscribe {
  const unsubscribeLsCommand = ctx.chat.on("command", "ls", async (event) => {
    const lsCommandEvent = event as LsCommandEvent<Extract<keyof TChats, string>>;
    const handled = await handleLsCommand({
      ctx: createHandlerContext({
        app: ctx,
        chatId: lsCommandEvent.chatId,
        actor: actorFromChatActor(lsCommandEvent.actor),
      }),
      event: lsCommandEvent,
    });

    if (handled.isErr()) {
      // TODO: report handler errors through diagnostics/observability.
      return;
    }
  });

  const unsubscribeInvalidCommand = ctx.chat.on("command.invalid", async (event) => {
    const responded = await replyToInvalidCommandUsage({
      event: event as InvalidCommandEvent,
      commandName: "ls",
      usage: formatLsCommandUsage(),
      onError: (cause) => new LsCommandResponseError({ cause }),
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
