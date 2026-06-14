import { Result } from "better-result";
import type { ChatAdapterSendActionInput, ChatSentMessage } from "@xmux/chat-core";
import type { DiscordBotClient } from "../client";
import type { DiscordAdapterConfig } from "../config";
import { encodeDiscordSendAction } from "../conversions/actions";
import { encodeDiscordSentMessage } from "../conversions/outbound";
import { DiscordSendActionError } from "../errors";
import {
  parseDiscordInteractionMessageId,
  type DiscordInteractionRegistry,
} from "../stores/interaction-registry";
import type { DiscordAdapterData, DiscordAdapterOptions } from "../types";

export async function sendAction<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly client: DiscordBotClient;
  readonly config: Pick<DiscordAdapterConfig, "defaultAllowedMentions" | "actionStore">;
  readonly interactionRegistry: DiscordInteractionRegistry;
  readonly input: ChatAdapterSendActionInput<TChatId, DiscordAdapterOptions>;
}): Promise<Result<ChatSentMessage<TChatId, DiscordAdapterData>, DiscordSendActionError>> {
  return Result.gen(async function* () {
    const request = yield* Result.await(
      encodeDiscordSendAction(args.input, {
        allowedMentions: args.config.defaultAllowedMentions,
        actionStore: args.config.actionStore,
      }),
    );

    const interactionId =
      args.input.message === undefined
        ? undefined
        : parseDiscordInteractionMessageId(args.input.message.messageId);
    const interactionContext =
      interactionId === undefined ? undefined : args.interactionRegistry.get(interactionId);

    const discordMessage = yield* Result.await(
      Result.tryPromise({
        try: () => {
          if (interactionId !== undefined && interactionContext !== undefined) {
            return args.interactionRegistry.markInitialResponseUsed(interactionId)
              ? interactionContext.editReply(request.payload)
              : interactionContext.followUp(request.payload);
          }

          return args.client.sendMessage({
            ...request,
            signal: args.input.signal,
          });
        },
        catch: (cause) => new DiscordSendActionError({ cause }),
      }),
    );

    return Result.ok(
      encodeDiscordSentMessage({
        chatId: args.chatId,
        text: args.input.text,
        format: args.input.format,
        discordMessage,
      }),
    );
  });
}
