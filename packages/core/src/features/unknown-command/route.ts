import type { Unsubscribe } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Context } from "../../ctx";
import { replyToChatEvent, type ChatEventWithReply } from "../utils";
import { UnknownCommandResponseError } from "./errors";
import { formatUnknownCommandResponse } from "./response";

/** Registers chat routes for unknown commands. */
export function registerUnknownCommandRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(ctx: Context<TAdapters, TChats>): Unsubscribe {
  return ctx.chat.on("command.unknown", async (event) => {
    const unknownCommandEvent = event as UnknownCommandEvent;
    const responded = await replyToChatEvent({
      event: unknownCommandEvent,
      message: formatUnknownCommandResponse(unknownCommandEvent.commandName),
      onError: (cause) => new UnknownCommandResponseError({ cause }),
    });

    if (responded.isErr()) {
      // TODO: report handler errors through diagnostics/observability.
      return;
    }
  });
}

type UnknownCommandEvent = ChatEventWithReply & {
  readonly commandName: string;
};
