import { defineChatAdapter, type ChatAdapterDefinition } from "@xmux/chat-core";
import { defaultTelegramAdapterMode } from "./config";
import { openTelegramRuntime } from "./runtime";
import type {
  CreateTelegramAdapterOptions,
  TelegramAdapterData,
  TelegramAdapterOptions,
} from "./types";

/** Creates a Telegram adapter for chat-core. */
export function createTelegramAdapter<const TChatId extends string = "telegram">(
  options: CreateTelegramAdapterOptions<TChatId>,
): ChatAdapterDefinition<TChatId, TelegramAdapterOptions, TelegramAdapterData> {
  const chatId = (options.id ?? "telegram") as TChatId;
  const mode = options.mode ?? defaultTelegramAdapterMode;

  return defineChatAdapter<TChatId, TelegramAdapterOptions, TelegramAdapterData>({
    id: chatId,
    async open() {
      return openTelegramRuntime({ chatId, options, mode });
    },
  });
}
