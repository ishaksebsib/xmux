import { defineChatAdapter, type ChatAdapterDefinition } from "@xmux/chat-core";
import { slackAdapterCapabilities } from "./capabilities";
import { openSlackRuntime } from "./runtime";
import type { SlackAdapterError } from "./errors";
import type { CreateSlackAdapterOptions, SlackAdapterData, SlackAdapterOptions } from "./types";

/** Creates a Slack adapter for chat-core. */
export function createSlackAdapter<const TChatId extends string = "slack">(
  options: CreateSlackAdapterOptions<TChatId> = {},
): ChatAdapterDefinition<
  TChatId,
  SlackAdapterOptions,
  SlackAdapterData,
  typeof slackAdapterCapabilities,
  SlackAdapterError
> {
  const chatId = (options.id ?? "slack") as TChatId;

  return defineChatAdapter<
    TChatId,
    SlackAdapterOptions,
    SlackAdapterData,
    typeof slackAdapterCapabilities,
    SlackAdapterError
  >({
    id: chatId,
    capabilities: slackAdapterCapabilities,
    async open(context) {
      return openSlackRuntime({
        chatId,
        options,
        logger: options.logger ?? context.logger,
      });
    },
  });
}
