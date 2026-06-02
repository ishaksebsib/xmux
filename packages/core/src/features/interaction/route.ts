import type { Unsubscribe } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Context } from "../../ctx";
import { runXmuxHandler, type XmuxMiddleware } from "../../middleware";
import { actorFromChatActor, replyToInvalidCommandUsage, type InvalidCommandEvent } from "../utils";
import { InteractionCommandResponseError } from "./errors";
import {
  handleInteractionCommand,
  type AllowCommandEvent,
  type RejectCommandEvent,
} from "./handler";
import { formatInvalidInteractionCommandUsage } from "./response";

/** Registers chat routes owned by interaction response commands. */
export function registerInteractionRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  ctx: Context<TAdapters, TChats>,
  middleware: readonly XmuxMiddleware<TAdapters, TChats>[] = [],
): Unsubscribe {
  const unsubscribeAllowCommand = ctx.chat.on("command", "allow", async (event) => {
    const allowCommandEvent = event as AllowCommandEvent<Extract<keyof TChats, string>>;
    const handled = await runXmuxHandler({
      app: ctx,
      event,
      middleware,
      actor: actorFromChatActor(allowCommandEvent.actor),
      handler: (handlerCtx) =>
        handleInteractionCommand({
          ctx: handlerCtx,
          event: allowCommandEvent,
          action: { type: "allow", always: allowCommandEvent.command.options.mode === "always" },
        }),
    });

    if (handled.isErr()) {
      // TODO: report handler errors through diagnostics/observability.
      return;
    }
  });

  const unsubscribeRejectCommand = ctx.chat.on("command", "reject", async (event) => {
    const rejectCommandEvent = event as RejectCommandEvent<Extract<keyof TChats, string>>;
    const handled = await runXmuxHandler({
      app: ctx,
      event,
      middleware,
      actor: actorFromChatActor(rejectCommandEvent.actor),
      handler: (handlerCtx) =>
        handleInteractionCommand({
          ctx: handlerCtx,
          event: rejectCommandEvent,
          action: { type: "reject" },
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

    if (
      invalidCommandEvent.commandName !== "allow" &&
      invalidCommandEvent.commandName !== "reject"
    ) {
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
          commandName: invalidCommandEvent.commandName,
          usage: formatInvalidInteractionCommandUsage({
            commandName: invalidCommandEvent.commandName as "allow" | "reject",
          }),
          onError: (cause) => new InteractionCommandResponseError({ cause }),
        }),
    });

    if (responded.isErr()) {
      // TODO: report handler errors through diagnostics/observability.
      return;
    }
  });

  return () => {
    unsubscribeAllowCommand();
    unsubscribeRejectCommand();
    unsubscribeInvalidCommand();
  };
}
