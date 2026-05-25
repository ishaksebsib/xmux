import type { Unsubscribe } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Context } from "../../ctx";
import { runXmuxHandler, type XmuxMiddleware } from "../../middleware";
import { actorFromChatActor, replyToInvalidCommandUsage, type InvalidCommandEvent } from "../utils";
import { ModelCommandResponseError } from "./errors";
import { handleModelCommand, type ModelCommandEvent } from "./handler";
import { formatModelCommandUsage } from "./response";

/** Registers chat routes owned by the `/model` feature. */
export function registerModelRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  ctx: Context<TAdapters, TChats>,
  middleware: readonly XmuxMiddleware<TAdapters, TChats>[] = [],
): Unsubscribe {
  const unsubscribeModelCommand = ctx.chat.on("command", "model", async (event) => {
    const modelCommandEvent = event as ModelCommandEvent<Extract<keyof TChats, string>>;
    const handled = await runXmuxHandler({
      app: ctx,
      event,
      middleware,
      actor: actorFromChatActor(modelCommandEvent.actor),
      handler: (handlerCtx) =>
        handleModelCommand({
          ctx: handlerCtx,
          event: modelCommandEvent,
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

    if (invalidCommandEvent.commandName !== "model") {
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
          commandName: "model",
          usage: formatModelCommandUsage(),
          onError: (cause) => new ModelCommandResponseError({ cause }),
        }),
    });

    if (responded.isErr()) {
      // TODO: report handler errors through diagnostics/observability.
      return;
    }
  });

  return () => {
    unsubscribeModelCommand();
    unsubscribeInvalidCommand();
  };
}
