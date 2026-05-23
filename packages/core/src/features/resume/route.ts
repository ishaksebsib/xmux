import type { Unsubscribe } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { createHandlerContext, type Context } from "../../ctx";
import { actorFromChatActor, replyToInvalidCommandUsage, type InvalidCommandEvent } from "../utils";
import { ResumeCommandResponseError } from "./errors";
import { handleResumeCommand, type ResumeCommandEvent } from "./handler";
import { formatResumeCommandUsage } from "./response";

/** Registers chat routes owned by the `/resume` feature. */
export function registerResumeRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(ctx: Context<TAdapters, TChats>): Unsubscribe {
  const unsubscribeResumeCommand = ctx.chat.on("command", "resume", async (event) => {
    const resumeCommandEvent = event as ResumeCommandEvent<Extract<keyof TChats, string>>;
    const handled = await handleResumeCommand({
      ctx: createHandlerContext({
        app: ctx,
        chatId: resumeCommandEvent.chatId,
        actor: actorFromChatActor(resumeCommandEvent.actor),
      }),
      event: resumeCommandEvent,
    });

    if (handled.isErr()) {
      // TODO: report handler errors through diagnostics/observability.
      return;
    }
  });

  const unsubscribeInvalidCommand = ctx.chat.on("command.invalid", async (event) => {
    const responded = await replyToInvalidCommandUsage({
      event: event as InvalidCommandEvent,
      commandName: "resume",
      usage: formatResumeCommandUsage(),
      onError: (cause) => new ResumeCommandResponseError({ cause }),
    });

    if (responded.isErr()) {
      // TODO: report handler errors through diagnostics/observability.
      return;
    }
  });

  return () => {
    unsubscribeResumeCommand();
    unsubscribeInvalidCommand();
  };
}
