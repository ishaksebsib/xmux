import { defineChatAdapter, type ChatAdapterDefinition } from "@xmux/chat-core";
import { discordAdapterCapabilities } from "./capabilities";
import { normalizeDiscordMode } from "./config";
import { openDiscordRuntime } from "./runtime";
import type { CreateDiscordBotClient } from "./client";
import type { DiscordAdapterError } from "./errors";
import type {
  CreateDiscordAdapterOptions,
  DiscordAdapterData,
  DiscordAdapterOptions,
} from "./types";

/** Creates a Discord adapter for chat-core. */
export function createDiscordAdapter<const TChatId extends string = "discord">(
  options: CreateDiscordAdapterOptions<TChatId>,
): ChatAdapterDefinition<
  TChatId,
  DiscordAdapterOptions,
  DiscordAdapterData,
  typeof discordAdapterCapabilities,
  DiscordAdapterError
> {
  const chatId = (options.id ?? "discord") as TChatId;
  const mode = normalizeDiscordMode(options.mode);
  const testing = options as CreateDiscordAdapterOptions<TChatId> & {
    readonly createClient?: CreateDiscordBotClient;
  };

  return defineChatAdapter<
    TChatId,
    DiscordAdapterOptions,
    DiscordAdapterData,
    typeof discordAdapterCapabilities,
    DiscordAdapterError
  >({
    id: chatId,
    capabilities: discordAdapterCapabilities,
    async open(context) {
      return openDiscordRuntime({
        chatId,
        options,
        mode,
        createClient: testing.createClient,
        logger: options.logger ?? context.logger,
      });
    },
  });
}
