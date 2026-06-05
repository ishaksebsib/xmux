import type { Unsubscribe } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Context } from "../../ctx";
import { runXmuxHandler, type XmuxMiddleware } from "../../middleware";
import { actorFromChatActor, replyToInvalidCommandUsage, type InvalidCommandEvent } from "../utils";
import { ThinkingCommandResponseError } from "./errors";
import {
  handleThinkingAction,
  handleThinkingCommand,
  type ThinkingActionEvent,
  type ThinkingCommandEvent,
} from "./handler";
import { formatThinkingCommandUsage } from "./response";

/** Registers chat routes owned by the `/thinking` feature. */
export function registerThinkingRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  ctx: Context<TAdapters, TChats>,
  middleware: readonly XmuxMiddleware<TAdapters, TChats>[] = [],
): Unsubscribe {
  const unsubscribeThinkingCommand = ctx.chat.on("command", "thinking", async (event) => {
    const thinkingCommandEvent = event as ThinkingCommandEvent<Extract<keyof TChats, string>>;
    const handled = await runXmuxHandler({
      app: ctx,
      event,
      middleware,
      actor: actorFromChatActor(thinkingCommandEvent.actor),
      handler: (handlerCtx) =>
        handleThinkingCommand({
          ctx: handlerCtx,
          event: thinkingCommandEvent,
        }),
    });

    if (handled.isErr()) {
      // TODO: report handler errors through diagnostics/observability.
      return;
    }
  });

  const unsubscribeThinkingAction = ctx.chat.on("action", "thinking", async (event) => {
    const thinkingActionEvent = event as ThinkingActionEvent<Extract<keyof TChats, string>>;
    const handled = await runXmuxHandler({
      app: ctx,
      event,
      middleware,
      actor: actorFromChatActor(thinkingActionEvent.actor),
      handler: (handlerCtx) =>
        handleThinkingAction({
          ctx: handlerCtx,
          event: thinkingActionEvent,
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

    if (invalidCommandEvent.commandName !== "thinking") {
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
          commandName: "thinking",
          usage: formatThinkingCommandUsage(),
          onError: (cause) => new ThinkingCommandResponseError({ cause }),
        }),
    });

    if (responded.isErr()) {
      // TODO: report handler errors through diagnostics/observability.
      return;
    }
  });

  return () => {
    unsubscribeThinkingCommand();
    unsubscribeThinkingAction();
    unsubscribeInvalidCommand();
  };
}
