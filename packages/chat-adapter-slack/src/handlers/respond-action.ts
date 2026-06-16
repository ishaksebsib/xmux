import { Result } from "better-result";
import type { ChatAdapterRespondToActionInput } from "@xmux/chat-core";
import type { SlackBotClient } from "../client";
import type { SlackAdapterConfig } from "../config";
import { encodeSlackActionResponse } from "../conversions/actions";
import { SlackActionResponseError } from "../errors";
import type { SlackInteractionRegistry } from "../stores/interaction-registry";
import type { SlackAdapterOptions } from "../types";

export async function respondToAction<TChatId extends string>(args: {
  readonly client: SlackBotClient;
  readonly config: Pick<SlackAdapterConfig, "actionStore">;
  readonly interactionRegistry: SlackInteractionRegistry;
  readonly input: ChatAdapterRespondToActionInput<TChatId, SlackAdapterOptions>;
}): Promise<Result<void, SlackActionResponseError>> {
  return Result.gen(async function* () {
    const context = args.interactionRegistry.getAction(args.input.interactionId);
    if (context === undefined) {
      return Result.err(
        new SlackActionResponseError({
          reason: `Slack action interaction is no longer available: ${args.input.interactionId}`,
        }),
      );
    }

    const request = yield* Result.await(
      encodeSlackActionResponse(args.input, {
        interaction: context,
        actionStore: args.config.actionStore,
      }),
    );

    yield* Result.await(
      Result.tryPromise({
        try: async () => {
          if (request.kind === "noop") {
            return;
          }

          if (request.kind === "ack") {
            await args.client.postEphemeral(request.ephemeral);
            return;
          }

          if (request.kind === "update") {
            await args.client.updateMessage(request.update);
            return;
          }

          if ("postEphemeral" in request) {
            await args.client.postEphemeral(request.postEphemeral);
            return;
          }

          await args.client.postMessage(request.postMessage);
        },
        catch: (cause) => new SlackActionResponseError({ cause }),
      }),
    );

    return Result.ok();
  });
}
