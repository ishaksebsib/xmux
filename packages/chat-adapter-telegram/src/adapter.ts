import { Result } from "better-result";
import { defineChatAdapter, type ChatAdapterDefinition } from "@xmux/chat-core";
import { telegramAdapterCapabilities } from "./capabilities";
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

  return defineChatAdapter<TChatId, TelegramAdapterOptions, TelegramAdapterData>({
    id: chatId,
    async open() {
      return Result.ok({
        id: chatId,
        capabilities: telegramAdapterCapabilities,
        async start() {
          return Result.ok();
        },
        async sendMessage() {
          return Result.err(new Error("Telegram adapter sendMessage is not implemented yet"));
        },
        async reply() {
          return Result.err(new Error("Telegram adapter reply is not implemented yet"));
        },
        async close() {
          return undefined;
        },
      });
    },
  });
}
