import type { ChatAdapterDefinitions, Unsubscribe } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { sttActionId } from "../../actions";
import type { Context } from "../../ctx";
import type { XmuxMiddleware } from "../../middleware";
import { dispatch } from "../routing";
import { handleSttAction, type HandleSttActionInput } from "./handler";

/** Registers chat action routes owned by the STT feature. */
export function registerSttRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  ctx: Context<TAdapters, TChats>,
  middleware: readonly XmuxMiddleware<TAdapters, TChats>[] = [],
): Unsubscribe {
  return ctx.chat.on("action", sttActionId, (raw) => {
    const event = raw as HandleSttActionInput<TAdapters, TChats>["event"];
    return dispatch(ctx, middleware, {
      event,
      actor: event.actor,
      routeName: "stt",
      handler: (handlerCtx) => handleSttAction({ ctx: handlerCtx, event }),
    });
  });
}
