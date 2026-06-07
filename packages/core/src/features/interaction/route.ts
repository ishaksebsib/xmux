import type { ChatAdapterDefinitions, Unsubscribe } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Context } from "../../ctx";
import type { XmuxMiddleware } from "../../middleware";
import { dispatch, registerInvalidCommandRoute } from "../routing";
import type { CommandEvent } from "../utils";
import { handleInteractionCommand } from "./handler";
import { formatInvalidInteractionCommandUsage } from "./response";

export function registerInteractionRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  ctx: Context<TAdapters, TChats>,
  middleware: readonly XmuxMiddleware<TAdapters, TChats>[] = [],
): Unsubscribe {
  const unsubscribeAllow = ctx.chat.on("command", "allow", (raw) => {
    const event = raw as CommandEvent<
      Extract<keyof TChats, string>,
      "allow",
      { readonly mode?: "always" }
    >;
    return dispatch(ctx, middleware, {
      event,
      actor: event.actor,
      handler: (handlerCtx) =>
        handleInteractionCommand({
          ctx: handlerCtx,
          event,
          action: { type: "allow", always: event.command.options.mode === "always" },
        }),
    });
  });

  const unsubscribeReject = ctx.chat.on("command", "reject", (raw) => {
    const event = raw as CommandEvent<Extract<keyof TChats, string>, "reject">;
    return dispatch(ctx, middleware, {
      event,
      actor: event.actor,
      handler: (handlerCtx) =>
        handleInteractionCommand({
          ctx: handlerCtx,
          event,
          action: { type: "reject" },
        }),
    });
  });

  const unsubscribeInvalid = registerInvalidCommandRoute(ctx, middleware, {
    commands: ["allow", "reject"],
    usage: (name) =>
      formatInvalidInteractionCommandUsage({ commandName: name as "allow" | "reject" }),
  });

  return () => {
    unsubscribeAllow();
    unsubscribeReject();
    unsubscribeInvalid();
  };
}
