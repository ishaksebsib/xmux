import { Result } from "better-result";
import type { ChatAdapterRespondToActionInput } from "@xmux/chat-core";
import type { DiscordAdapterConfig } from "../config";
import { encodeDiscordActionResponse } from "../conversions/actions";
import { DiscordActionResponseError } from "../errors";
import type { DiscordInteractionRegistry } from "../stores/interaction-registry";
import type { DiscordAdapterOptions } from "../types";

export async function respondToAction<TChatId extends string>(args: {
  readonly config: Pick<DiscordAdapterConfig, "defaultAllowedMentions" | "actionStore">;
  readonly interactionRegistry: DiscordInteractionRegistry;
  readonly input: ChatAdapterRespondToActionInput<TChatId, DiscordAdapterOptions>;
}): Promise<Result<void, DiscordActionResponseError>> {
  return Result.gen(async function* () {
    const context = args.interactionRegistry.get(args.input.interactionId);
    if (context === undefined) {
      return Result.err(
        new DiscordActionResponseError({
          reason: `Discord action interaction is no longer available: ${args.input.interactionId}`,
        }),
      );
    }

    const request = yield* Result.await(
      encodeDiscordActionResponse(args.input, {
        allowedMentions: args.config.defaultAllowedMentions,
        actionStore: args.config.actionStore,
      }),
    );

    yield* Result.await(
      Result.tryPromise({
        try: async () => {
          if (
            request.kind === "noop" ||
            (request.kind === "ack" && request.followUp === undefined)
          ) {
            return;
          }

          if (request.kind === "update") {
            await context.editReply(request.edit);
            return;
          }

          if (request.kind === "ack") {
            const followUp = request.followUp;
            if (followUp !== undefined) {
              await context.followUp(followUp);
            }
            return;
          }

          await context.followUp(request.followUp);
        },
        catch: (cause) => new DiscordActionResponseError({ cause }),
      }),
    );

    return Result.ok();
  });
}
