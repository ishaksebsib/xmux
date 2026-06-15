import type { ChatAdapterDefinitions, Unsubscribe } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { resumeHarnessActionId, resumeSessionActionId } from "../../actions";
import type { Context } from "../../ctx";
import type { XmuxMiddleware } from "../../middleware";
import { dispatch, registerInvalidCommandRoute } from "../routing";
import type { CommandEvent } from "../utils";
import {
  handleResumeCommand,
  handleResumeHarnessAction,
  handleResumeSessionAction,
  type HandleResumeHarnessActionInput,
  type HandleResumeSessionActionInput,
} from "./handler";
import { formatResumeCommandUsage } from "./response";

export function registerResumeRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  ctx: Context<TAdapters, TChats>,
  middleware: readonly XmuxMiddleware<TAdapters, TChats>[] = [],
): Unsubscribe {
  const unsubscribeCommand = ctx.chat.on("command", "resume", (raw) => {
    const event = raw as CommandEvent<
      Extract<keyof TChats, string>,
      "resume",
      { readonly harnessId?: string; readonly shortId?: string }
    >;
    return dispatch(ctx, middleware, {
      event,
      actor: event.actor,
      handler: (handlerCtx) => handleResumeCommand({ ctx: handlerCtx, event }),
    });
  });

  const unsubscribeHarnessAction = ctx.chat.on("action", resumeHarnessActionId, (raw) => {
    const event = raw as HandleResumeHarnessActionInput<TAdapters, TChats>["event"];
    return dispatch(ctx, middleware, {
      event,
      actor: event.actor,
      handler: (handlerCtx) => handleResumeHarnessAction({ ctx: handlerCtx, event }),
    });
  });

  const unsubscribeSessionAction = ctx.chat.on("action", resumeSessionActionId, (raw) => {
    const event = raw as HandleResumeSessionActionInput<TAdapters, TChats>["event"];
    return dispatch(ctx, middleware, {
      event,
      actor: event.actor,
      handler: (handlerCtx) => handleResumeSessionAction({ ctx: handlerCtx, event }),
    });
  });

  const unsubscribeInvalid = registerInvalidCommandRoute(ctx, middleware, {
    commands: ["resume"],
    usage: formatResumeCommandUsage,
  });

  return () => {
    unsubscribeCommand();
    unsubscribeHarnessAction();
    unsubscribeSessionAction();
    unsubscribeInvalid();
  };
}
