import type {
  ChatAdapterRespondToActionInput,
  ChatAdapterSendActionInput,
  ChatAdapterUpdateActionInput,
  ChatButton,
  ChatTextInput,
} from "@xmux/chat-core";
import type { InlineKeyboardButton, InlineKeyboardMarkup } from "grammy/types";
import type { TelegramBotClient } from "../client";
import {
  TelegramActionResponseError,
  TelegramSendActionError,
  TelegramUpdateActionError,
} from "../errors";
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

export type TelegramActionUpdateRequest = {
  readonly kind: "update";
  readonly chatId: string;
  readonly messageId: number;
  readonly text: string;
  readonly options: TelegramEditMessageOptions;
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
  | TelegramActionUpdateRequest;

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

export function encodeTelegramActionUpdate(
  input: ChatAdapterUpdateActionInput<string, TelegramAdapterOptions>,
): TelegramActionUpdateRequest {
  return encodeTelegramActionUpdateRequest({
    conversationId: input.conversationId,
    messageId: input.message.messageId,
    message: { text: input.text, format: input.format },
    buttons: input.buttons,
    adapterOptions: input.adapterOptions,
    signal: input.signal,
    createError: (reason) => new TelegramUpdateActionError({ reason }),
  });
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

  return encodeTelegramActionUpdateRequest({
    conversationId: input.conversationId,
    messageId: input.message.messageId,
    message: input.response.message,
    buttons: input.response.buttons,
    adapterOptions: input.adapterOptions,
    signal: input.signal,
    createError: (reason) => new TelegramActionResponseError({ reason }),
  });
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

function encodeTelegramActionUpdateRequest<TError extends Error>(args: {
  readonly conversationId: string;
  readonly messageId: string;
  readonly message: ChatTextInput;
  readonly buttons?: readonly (readonly ChatButton[])[];
  readonly adapterOptions: TelegramAdapterOptions;
  readonly signal?: AbortSignal;
  readonly createError: (reason: string) => TError;
}): TelegramActionUpdateRequest {
  const messageId = parseTelegramMessageId(args.messageId);
  if (messageId === undefined) {
    throw args.createError(
      `Telegram action update message id must be a positive integer: ${args.messageId}`,
    );
  }

  const content = normalizeActionTextInput(args.message);
  const formattedText = encodeTelegramFormattedText({
    text: content.text,
    format: content.format,
    adapterOptions: args.adapterOptions,
  });

  return {
    kind: "update",
    chatId: args.conversationId,
    messageId,
    text: formattedText.text,
    options: {
      ...formattedText.options,
      ...args.adapterOptions,
      ...(args.buttons === undefined ? {} : { reply_markup: encodeTelegramInlineKeyboard(args.buttons) }),
    } as TelegramEditMessageOptions,
    signal: args.signal,
  };
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
