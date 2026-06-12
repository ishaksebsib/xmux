import type { ChatLogger } from "@xmux/chat-core";
import type { Bot, PollingOptions } from "grammy";

/** Telegram update type accepted by `allowedUpdates`. */
export type TelegramAllowedUpdate = NonNullable<PollingOptions["allowed_updates"]>[number];

/** Selects how Telegram updates are delivered. */
export type TelegramAdapterMode =
  | {
      readonly type: "polling";
      readonly dropPendingUpdates?: boolean;
      readonly allowedUpdates?: readonly TelegramAllowedUpdate[];
    }
  | {
      readonly type: "webhook";
      readonly secretToken?: string;
      readonly allowedUpdates?: readonly TelegramAllowedUpdate[];
    };

/** Options forwarded to grammY's `Bot` constructor. */
export type TelegramBotOptions = ConstructorParameters<typeof Bot>[1];

/** Native Telegram options. */
export type TelegramAdapterOptions = NonNullable<Parameters<Bot["api"]["sendMessage"]>[2]>;

/** Native Telegram metadata kept opaque by chat-core. */
export type TelegramAdapterData = {
  readonly telegramChatId: string;
  readonly telegramMessageId?: number;
  readonly telegramFileId?: string;
  readonly telegramFileUniqueId?: string;
  readonly updateId?: number;
  readonly raw: unknown;
};

/** Configuration for creating a Telegram chat adapter. */
export interface CreateTelegramAdapterOptions<TChatId extends string = "telegram"> {
  readonly id?: TChatId;
  readonly token: string;
  readonly mode?: TelegramAdapterMode;
  readonly botOptions?: TelegramBotOptions;
  readonly logger?: ChatLogger;
}
