import type { Unsubscribe } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { createHandlerContext, type Context } from "../../../ctx";
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
>(ctx: Context<TAdapters, TChats>): Unsubscribe {
  const unsubscribeCdCommand = ctx.chat.on("command", "cd", async (event) => {
    const cdCommandEvent = event as CdCommandEvent<Extract<keyof TChats, string>>;
    const handled = await handleCdCommand({
      ctx: createHandlerContext({
        app: ctx,
        chatId: cdCommandEvent.chatId,
        actor: actorFromChatActor(cdCommandEvent.actor),
      }),
      event: cdCommandEvent,
    });

    if (handled.isErr()) {
      // TODO: report handler errors through diagnostics/observability.
      return;
    }
  });

  const unsubscribeInvalidCommand = ctx.chat.on("command.invalid", async (event) => {
    const responded = await replyToInvalidCommandUsage({
      event: event as InvalidCommandEvent,
      commandName: "cd",
      usage: formatCdCommandUsage(),
      onError: (cause) => new CdCommandResponseError({ cause }),
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
