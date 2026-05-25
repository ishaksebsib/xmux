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
import { PwdCommandResponseError } from "./errors";
import { handlePwdCommand, type PwdCommandEvent } from "./handler";
import { formatPwdCommandUsage } from "./response";

/** Registers chat routes owned by the `/pwd` feature. */
export function registerPwdRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  ctx: Context<TAdapters, TChats>,
  middleware: readonly XmuxMiddleware<TAdapters, TChats>[] = [],
): Unsubscribe {
  const unsubscribePwdCommand = ctx.chat.on("command", "pwd", async (event) => {
    const pwdCommandEvent = event as PwdCommandEvent<Extract<keyof TChats, string>>;
    const handled = await runXmuxHandler({
      app: ctx,
      event,
      middleware,
      actor: actorFromChatActor(pwdCommandEvent.actor),
      handler: (handlerCtx) =>
        handlePwdCommand({
          ctx: handlerCtx,
          event: pwdCommandEvent,
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

    if (invalidCommandEvent.commandName !== "pwd") {
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
          commandName: "pwd",
          usage: formatPwdCommandUsage(),
          onError: (cause) => new PwdCommandResponseError({ cause }),
        }),
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
