import type { AdapterDataFor, Unsubscribe } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Result } from "better-result";
import type { Context } from "../../ctx";
import { runXmuxHandler, type XmuxMiddleware } from "../../middleware";
import { actorFromChatActor } from "../utils";
import { classifyAudioMessage, handleSttAudioMessage, handleSttUnsupportedMessage } from "../stt";
import { handlePromptMessage, isUserPromptActor, type PromptMessageEvent } from "./handler";

/** Registers chat routes owned by the prompt feature. */
export function registerPromptRoute<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  ctx: Context<TAdapters, TChats>,
  middleware: readonly XmuxMiddleware<TAdapters, TChats>[] = [],
): Unsubscribe {
  return ctx.chat.on("message", async (event) => {
    const promptEvent = event as PromptMessageEvent<
      Extract<keyof TChats, string>,
      AdapterDataFor<TChats, Extract<keyof TChats, string>>
    >;

    if (!isUserPromptActor(promptEvent.message.actor)) {
      return;
    }

    if (
      promptEvent.message.text.trim().length === 0 &&
      promptEvent.message.attachments.length === 0
    ) {
      return;
    }

    const audio = classifyAudioMessage(promptEvent.message);

    await runXmuxHandler({
      app: ctx,
      event,
      middleware,
      routeName: audio.type === "no_audio" ? "prompt" : "stt",
      actor: actorFromChatActor(promptEvent.message.actor),
      handler: async (handlerCtx): Promise<Result<unknown, unknown>> => {
        switch (audio.type) {
          case "no_audio":
            return handlePromptMessage({ ctx: handlerCtx, event: promptEvent });
          case "single_audio":
            return handleSttAudioMessage({
              ctx: handlerCtx,
              event: promptEvent,
              attachment: audio.attachment,
            });
          case "unsupported":
            return handleSttUnsupportedMessage({
              ctx: handlerCtx,
              event: promptEvent,
              error: audio.error,
            });
        }
      },
    });
  });
}
