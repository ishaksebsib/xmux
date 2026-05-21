import type { Unsubscribe } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { createHandlerContext, type Context } from "../../../ctx";
import { actorFromChatActor, replyToInvalidCommandUsage, type InvalidCommandEvent } from "../../utils";
import { PwdCommandResponseError } from "./errors";
import { handlePwdCommand, type PwdCommandEvent } from "./handler";
import { formatPwdCommandUsage } from "./response";

/** Registers chat routes owned by the `/pwd` feature. */
export function registerPwdRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(ctx: Context<TAdapters, TChats>): Unsubscribe {
  const unsubscribePwdCommand = ctx.chat.on("command", "pwd", async (event) => {
    const pwdCommandEvent = event as PwdCommandEvent<Extract<keyof TChats, string>>;
    const handled = await handlePwdCommand({
      ctx: createHandlerContext({
        app: ctx,
        chatId: pwdCommandEvent.chatId,
        actor: actorFromChatActor(pwdCommandEvent.actor),
      }),
      event: pwdCommandEvent,
    });

    if (handled.isErr()) {
      // TODO: report handler errors through diagnostics/observability.
      return;
    }
  });

  const unsubscribeInvalidCommand = ctx.chat.on("command.invalid", async (event) => {
    const responded = await replyToInvalidCommandUsage({
      event: event as InvalidCommandEvent,
      commandName: "pwd",
      usage: formatPwdCommandUsage(),
      onError: (cause) => new PwdCommandResponseError({ cause }),
    });

    if (responded.isErr()) {
      // TODO: report handler errors through diagnostics/observability.
      return;
    }
  });

  return () => {
    unsubscribePwdCommand();
    unsubscribeInvalidCommand();
  };
}
