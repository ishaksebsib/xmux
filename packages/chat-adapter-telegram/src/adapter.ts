import { defineChatAdapter, type ChatAdapterDefinition } from "@xmux/chat-core";
import { telegramAdapterCapabilities } from "./capabilities";
import { defaultTelegramAdapterMode } from "./config";
import { openTelegramRuntime } from "./runtime";
import type { TelegramAdapterError } from "./errors";
import type {
  CreateTelegramAdapterOptions,
  TelegramAdapterData,
  TelegramAdapterOptions,
} from "./types";

/** Creates a Telegram adapter for chat-core. */
export function createTelegramAdapter<const TChatId extends string = "telegram">(
  options: CreateTelegramAdapterOptions<TChatId>,
): ChatAdapterDefinition<
  TChatId,
  TelegramAdapterOptions,
  TelegramAdapterData,
  typeof telegramAdapterCapabilities,
  TelegramAdapterError
> {
  const chatId = (options.id ?? "telegram") as TChatId;
  const mode = options.mode ?? defaultTelegramAdapterMode;

  return defineChatAdapter<
    TChatId,
    TelegramAdapterOptions,
    TelegramAdapterData,
    typeof telegramAdapterCapabilities,
    TelegramAdapterError
  >({
    id: chatId,
    capabilities: telegramAdapterCapabilities,
    async open(context) {
      return openTelegramRuntime({
        chatId,
        options,
        mode,
        logger: options.logger ?? context.logger,
      });
    },
  });
}
