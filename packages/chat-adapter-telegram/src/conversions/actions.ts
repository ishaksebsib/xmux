import type {
  ChatAdapterRespondToActionInput,
  ChatAdapterSendActionInput,
  ChatButton,
  ChatTextInput,
} from "@xmux/chat-core";
import type { InlineKeyboardButton, InlineKeyboardMarkup } from "grammy/types";
import type { TelegramBotClient } from "../client";
import { TelegramActionResponseError, TelegramSendActionError } from "../errors";
import type { TelegramAdapterOptions } from "../types";
import { encodeTelegramFormattedText } from "./formatting";

const telegramActionPayloadLimit = 64;

type TelegramInlineKeyboardButton = InlineKeyboardButton;
type TelegramInlineKeyboardMarkup = InlineKeyboardMarkup;
type TelegramEditMessageOptions = Parameters<TelegramBotClient["editMessageText"]>[0]["options"];

export type TelegramSendActionRequest = {
  readonly chatId: string;
  readonly text: string;
  readonly options: TelegramAdapterOptions & {
    readonly reply_markup: TelegramInlineKeyboardMarkup;
  };
  readonly signal?: AbortSignal;
};

export type TelegramActionResponseRequest =
  | {
      readonly kind: "ack";
      readonly callbackQueryId: string;
      readonly options?: Parameters<TelegramBotClient["answerCallbackQuery"]>[0]["options"];
      readonly signal?: AbortSignal;
    }
  | {
      readonly kind: "reply";
      readonly chatId: string;
      readonly text: string;
      readonly options: TelegramAdapterOptions;
      readonly signal?: AbortSignal;
    }
  | {
      readonly kind: "update";
      readonly chatId: string;
      readonly messageId: number;
      readonly text: string;
      readonly options: TelegramEditMessageOptions;
      readonly signal?: AbortSignal;
    };

export interface TelegramActionCallbackData {
  readonly actionId: string;
  readonly value: string;
  readonly payload?: unknown;
}

export function encodeTelegramSendAction(
  input: ChatAdapterSendActionInput<string, TelegramAdapterOptions>,
): TelegramSendActionRequest {
  const formattedText = encodeTelegramFormattedText({
    text: input.text,
    format: input.format,
    adapterOptions: input.adapterOptions,
  });

  return {
    chatId: input.conversationId,
    text: formattedText.text,
    options: {
      ...formattedText.options,
      ...input.adapterOptions,
      reply_markup: encodeTelegramInlineKeyboard(input.buttons),
    },
    signal: input.signal,
  };
}

export function encodeTelegramActionResponse(
  input: ChatAdapterRespondToActionInput<string, TelegramAdapterOptions>,
): TelegramActionResponseRequest {
  if (input.response.kind === "ack") {
    return {
      kind: "ack",
      callbackQueryId: input.interactionId,
      options: {
        ...(input.response.text === undefined ? {} : { text: input.response.text }),
        ...(input.response.showAlert === undefined ? {} : { show_alert: input.response.showAlert }),
      },
      signal: input.signal,
    };
  }

  if (input.response.kind === "reply") {
    const content = normalizeActionTextInput(input.response.message);
    const formattedText = encodeTelegramFormattedText({
      text: content.text,
      format: content.format,
      adapterOptions: input.adapterOptions,
    });

    return {
      kind: "reply",
      chatId: input.conversationId,
      text: formattedText.text,
      options: { ...formattedText.options, ...input.adapterOptions },
      signal: input.signal,
    };
  }

  if (input.response.message === undefined) {
    throw new TelegramActionResponseError({
      reason:
        "Telegram action update requires response.message because Telegram editMessageText always needs text",
    });
  }

  const messageId = parseTelegramMessageId(input.message.messageId);
  if (messageId === undefined) {
    throw new TelegramActionResponseError({
      reason: `Telegram action update message id must be a positive integer: ${input.message.messageId}`,
    });
  }

  const content = normalizeActionTextInput(input.response.message);
  const formattedText = encodeTelegramFormattedText({
    text: content.text,
    format: content.format,
    adapterOptions: input.adapterOptions,
  });

  return {
    kind: "update",
    chatId: input.conversationId,
    messageId,
    text: formattedText.text,
    options: {
      ...formattedText.options,
      ...input.adapterOptions,
      ...(input.response.buttons === undefined
        ? {}
        : { reply_markup: encodeTelegramInlineKeyboard(input.response.buttons) }),
    } as TelegramEditMessageOptions,
    signal: input.signal,
  };
}

export function decodeTelegramActionCallbackData(
  data: string,
): TelegramActionCallbackData | undefined {
  try {
    const parsed = JSON.parse(data) as unknown;
    if (!isActionCallbackData(parsed)) {
      return undefined;
    }

    return parsed;
  } catch {
    return undefined;
  }
}

function encodeTelegramInlineKeyboard(
  rows: readonly (readonly ChatButton[])[],
): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: rows.map((row) => row.map(encodeTelegramInlineKeyboardButton)),
  };
}

function encodeTelegramInlineKeyboardButton(button: ChatButton): TelegramInlineKeyboardButton {
  if (button.kind === "url") {
    return { text: button.label, url: button.url };
  }

  const callbackData = JSON.stringify({
    actionId: button.actionId,
    value: button.value,
    ...(button.payload === undefined ? {} : { payload: button.payload }),
  });

  if (Buffer.byteLength(callbackData, "utf8") > telegramActionPayloadLimit) {
    throw new TelegramSendActionError({
      reason: `Telegram action callback payload exceeds ${telegramActionPayloadLimit} bytes`,
    });
  }

  return { text: button.label, callback_data: callbackData };
}

function normalizeActionTextInput(message: ChatTextInput) {
  return typeof message === "string" ? { text: message } : message;
}

function parseTelegramMessageId(messageId: string): number | undefined {
  const parsed = Number(messageId);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function isActionCallbackData(value: unknown): value is TelegramActionCallbackData {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const data = value as Record<string, unknown>;
  return typeof data.actionId === "string" && typeof data.value === "string";
}
