import { Result } from "better-result";
import type {
  ChatActor,
  ChatAdapterActionEvent,
  ChatAdapterEvent,
  ChatAdapterMessageEvent,
  ChatAttachment,
  ChatAttachmentContent,
  ChatAttachmentKind,
  ChatCommandRegistry,
} from "@xmux/chat-core";
import type {
  TelegramBotClient,
  TelegramCallbackQueryDataContext,
  TelegramMessageContext,
  TelegramTextMessageContext,
} from "../client";
import { createTelegramCommandEvent, parseTelegramCommand } from "../commands";
import { decodeTelegramActionCallbackData } from "./actions";
import { TelegramAttachmentReadError, type TelegramAdapterError } from "../errors";
import type { TelegramAdapterData } from "../types";

export type TelegramInboundDecodeResult<TEvent> =
  | { readonly status: "event"; readonly event: TEvent }
  | { readonly status: "ignored"; readonly reason: "self_message" | "unsupported_action" };

export function decodeTelegramMessageUpdate<
  TCommands extends ChatCommandRegistry,
  TChatId extends string,
>(args: {
  readonly chatId: TChatId;
  readonly commands: TCommands;
  readonly context: TelegramMessageContext;
  readonly bot: TelegramBotClient;
  readonly botUserId: number;
  readonly botUsername: string;
}): TelegramInboundDecodeResult<
  ChatAdapterEvent<
    TCommands,
    TChatId,
    { readonly [TKey in TChatId]: TelegramAdapterData },
    { readonly [TKey in TChatId]: TelegramAdapterError }
  >
> {
  const messageEvent = decodeTelegramMessage({
    chatId: args.chatId,
    context: args.context,
    bot: args.bot,
    botUserId: args.botUserId,
  });
  if (messageEvent.status === "ignored") {
    return messageEvent;
  }

  if (!isTelegramTextMessageContext(args.context)) {
    return messageEvent;
  }

  const command = parseTelegramCommand({
    commands: args.commands,
    context: args.context,
    botUsername: args.botUsername,
  });

  if (command.status === "unknown") {
    return {
      status: "event",
      event: {
        type: "command.unknown",
        chatId: args.chatId,
        conversation: messageEvent.event.conversation,
        message: {
          chatId: args.chatId,
          conversationId: messageEvent.event.conversation.conversationId,
          messageId: messageEvent.event.message.messageId,
        },
        actor: messageEvent.event.message.actor,
        commandName: command.commandName,
      },
    };
  }

  if (command.status === "invalid") {
    return {
      status: "event",
      event: {
        type: "command.invalid",
        chatId: args.chatId,
        conversation: messageEvent.event.conversation,
        message: {
          chatId: args.chatId,
          conversationId: messageEvent.event.conversation.conversationId,
          messageId: messageEvent.event.message.messageId,
        },
        actor: messageEvent.event.message.actor,
        commandName: command.commandName,
        reason: command.reason,
        optionName: command.optionName,
      },
    };
  }

  if (command.status !== "command") {
    return messageEvent;
  }

  return {
    status: "event",
    event: createTelegramCommandEvent({
      chatId: args.chatId,
      conversationId: messageEvent.event.conversation.conversationId,
      messageId: messageEvent.event.message.messageId,
      actor: messageEvent.event.message.actor,
      command: command.command,
    }),
  };
}

export function decodeTelegramTextUpdate<
  TCommands extends ChatCommandRegistry,
  TChatId extends string,
>(args: {
  readonly chatId: TChatId;
  readonly commands: TCommands;
  readonly context: TelegramTextMessageContext;
  readonly bot: TelegramBotClient;
  readonly botUserId: number;
  readonly botUsername: string;
}): TelegramInboundDecodeResult<
  ChatAdapterEvent<
    TCommands,
    TChatId,
    { readonly [TKey in TChatId]: TelegramAdapterData },
    { readonly [TKey in TChatId]: TelegramAdapterError }
  >
> {
  return decodeTelegramMessageUpdate(args);
}

export function decodeTelegramActionUpdate<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly context: TelegramCallbackQueryDataContext;
}): TelegramInboundDecodeResult<ChatAdapterActionEvent<TChatId>> {
  const decoded = decodeTelegramActionCallbackData(args.context.callbackQuery.data);
  const message = args.context.callbackQuery.message;
  const chat = message?.chat ?? args.context.chat;

  if (decoded === undefined || message === undefined || chat === undefined) {
    return { status: "ignored", reason: "unsupported_action" };
  }

  const adapterData = decodeTelegramAdapterData({
    chatId: chat.id,
    messageId: message.message_id,
    raw: args.context.callbackQuery,
    updateId: args.context.update.update_id,
  });
  const conversation = {
    chatId: args.chatId,
    conversationId: String(chat.id),
  };

  return {
    status: "event",
    event: {
      type: "action",
      chatId: args.chatId,
      conversation,
      message: {
        ...conversation,
        messageId: String(message.message_id),
      },
      interactionId: args.context.callbackQuery.id,
      actor: decodeTelegramActor({ chat, from: args.context.from, adapterData }),
      actionId: decoded.actionId,
      value: decoded.value,
      ...(decoded.payload === undefined ? {} : { payload: decoded.payload }),
    },
  };
}

function decodeTelegramMessage<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly context: TelegramMessageContext;
  readonly bot: TelegramBotClient;
  readonly botUserId: number;
}): TelegramInboundDecodeResult<
  ChatAdapterMessageEvent<TChatId, TelegramAdapterData, TelegramAdapterError>
> {
  const message = args.context.message;
  const chat = message.chat;
  const from = message.from ?? args.context.from;

  if (from?.id === args.botUserId) {
    return { status: "ignored", reason: "self_message" };
  }

  const conversation = {
    chatId: args.chatId,
    conversationId: String(chat.id),
  };
  const adapterData = decodeTelegramAdapterData({
    chatId: chat.id,
    messageId: message.message_id,
    raw: message,
    updateId: args.context.update.update_id,
  });

  return {
    status: "event",
    event: {
      type: "message",
      chatId: args.chatId,
      conversation,
      message: {
        ...conversation,
        messageId: String(message.message_id),
        text: messageText(message),
        format: "plain",
        actor: decodeTelegramActor({ chat, from, adapterData }),
        attachments: decodeTelegramAttachments({
          chatId: chat.id,
          messageId: message.message_id,
          updateId: args.context.update.update_id,
          message,
          bot: args.bot,
        }),
        adapterData,
      },
    },
  };
}

function messageText(message: TelegramMessageContext["message"]): string {
  return "text" in message && typeof message.text === "string"
    ? message.text
    : "caption" in message && typeof message.caption === "string"
      ? message.caption
      : "";
}

function isTelegramTextMessageContext(
  context: TelegramMessageContext,
): context is TelegramTextMessageContext {
  return "text" in context.message && typeof context.message.text === "string";
}

function decodeTelegramAttachments(args: {
  readonly chatId: number | string;
  readonly messageId: number;
  readonly updateId?: number;
  readonly message: TelegramMessageContext["message"];
  readonly bot: TelegramBotClient;
}): readonly ChatAttachment<TelegramAdapterData, TelegramAdapterError>[] {
  const attachments: ChatAttachment<TelegramAdapterData, TelegramAdapterError>[] = [];

  if ("photo" in args.message && Array.isArray(args.message.photo)) {
    const photo = largestTelegramPhoto(args.message.photo);
    if (photo !== undefined) {
      attachments.push(
        createTelegramAttachment({
          bot: args.bot,
          chatId: args.chatId,
          messageId: args.messageId,
          updateId: args.updateId,
          file: photo,
          kind: "image",
          disposition: "inline",
          mimeType: "image/jpeg",
          raw: photo,
        }),
      );
    }
  }

  if ("document" in args.message && args.message.document !== undefined) {
    const document = args.message.document;
    attachments.push(
      createTelegramAttachment({
        bot: args.bot,
        chatId: args.chatId,
        messageId: args.messageId,
        updateId: args.updateId,
        file: document,
        kind: kindFromDocument(document),
        disposition: "attachment",
        filename: document.file_name,
        mimeType: document.mime_type,
        raw: document,
      }),
    );
  }

  if ("video" in args.message && args.message.video !== undefined) {
    const video = args.message.video;
    attachments.push(
      createTelegramAttachment({
        bot: args.bot,
        chatId: args.chatId,
        messageId: args.messageId,
        updateId: args.updateId,
        file: video,
        kind: "video",
        disposition: "inline",
        filename: video.file_name,
        mimeType: video.mime_type,
        raw: video,
      }),
    );
  }

  if ("audio" in args.message && args.message.audio !== undefined) {
    const audio = args.message.audio;
    attachments.push(
      createTelegramAttachment({
        bot: args.bot,
        chatId: args.chatId,
        messageId: args.messageId,
        updateId: args.updateId,
        file: audio,
        kind: "audio",
        disposition: "attachment",
        filename: audio.file_name,
        mimeType: audio.mime_type,
        raw: audio,
      }),
    );
  }

  if ("voice" in args.message && args.message.voice !== undefined) {
    const voice = args.message.voice;
    attachments.push(
      createTelegramAttachment({
        bot: args.bot,
        chatId: args.chatId,
        messageId: args.messageId,
        updateId: args.updateId,
        file: voice,
        kind: "audio",
        disposition: "inline",
        mimeType: voice.mime_type,
        raw: voice,
      }),
    );
  }

  return attachments;
}

function createTelegramAttachment(args: {
  readonly bot: TelegramBotClient;
  readonly chatId: number | string;
  readonly messageId: number;
  readonly updateId?: number;
  readonly file: TelegramFileRef;
  readonly kind: ChatAttachmentKind;
  readonly disposition: "inline" | "attachment";
  readonly filename?: string;
  readonly mimeType?: string;
  readonly raw: unknown;
}): ChatAttachment<TelegramAdapterData, TelegramAdapterError> {
  const adapterData = decodeTelegramAdapterData({
    chatId: args.chatId,
    messageId: args.messageId,
    fileId: args.file.file_id,
    fileUniqueId: args.file.file_unique_id,
    raw: args.raw,
    updateId: args.updateId,
  });
  const attachmentId = args.file.file_unique_id ?? args.file.file_id;

  return {
    attachmentId,
    kind: args.kind,
    disposition: args.disposition,
    filename: args.filename,
    mimeType: args.mimeType,
    sizeBytes: args.file.file_size,
    adapterData,
    open: (input) =>
      openTelegramAttachment({
        bot: args.bot,
        attachmentId,
        file: args.file,
        filename: args.filename,
        mimeType: args.mimeType,
        input,
      }),
  };
}

async function openTelegramAttachment(args: {
  readonly bot: TelegramBotClient;
  readonly attachmentId: string;
  readonly file: TelegramFileRef;
  readonly filename?: string;
  readonly mimeType?: string;
  readonly input?: { readonly signal?: AbortSignal; readonly maxBytes?: number };
}): Promise<Result<ChatAttachmentContent, TelegramAdapterError>> {
  if (
    args.input?.maxBytes !== undefined &&
    args.file.file_size !== undefined &&
    args.file.file_size > args.input.maxBytes
  ) {
    return Result.err(
      new TelegramAttachmentReadError({
        attachmentId: args.attachmentId,
        reason: "too_large",
        maxBytes: args.input.maxBytes,
        sizeBytes: args.file.file_size,
      }),
    );
  }

  const metadata = await Result.tryPromise({
    try: () => args.bot.getFile({ fileId: args.file.file_id, signal: args.input?.signal }),
    catch: (cause) =>
      new TelegramAttachmentReadError({
        attachmentId: args.attachmentId,
        reason: "metadata",
        sizeBytes: args.file.file_size,
        cause,
      }),
  });
  if (metadata.isErr()) return Result.err(metadata.error);

  const filePath = metadata.value.file_path;
  if (filePath === undefined || filePath.length === 0) {
    return Result.err(
      new TelegramAttachmentReadError({
        attachmentId: args.attachmentId,
        reason: "missing_file_path",
        sizeBytes: metadata.value.file_size ?? args.file.file_size,
      }),
    );
  }

  const response = await Result.tryPromise({
    try: () => args.bot.downloadFile({ filePath, signal: args.input?.signal }),
    catch: (cause) =>
      new TelegramAttachmentReadError({
        attachmentId: args.attachmentId,
        reason: "download",
        sizeBytes: metadata.value.file_size ?? args.file.file_size,
        cause,
      }),
  });
  if (response.isErr()) return Result.err(response.error);

  if (!response.value.ok || response.value.body === null) {
    return Result.err(
      new TelegramAttachmentReadError({
        attachmentId: args.attachmentId,
        reason: "invalid_response",
        sizeBytes: metadata.value.file_size ?? args.file.file_size,
        cause: response.value.statusText || response.value.status,
      }),
    );
  }

  const sizeBytes = metadata.value.file_size ?? args.file.file_size;
  const contentLength = readContentLength(response.value.headers);
  if (
    args.input?.maxBytes !== undefined &&
    contentLength !== undefined &&
    contentLength > args.input.maxBytes
  ) {
    return Result.err(
      new TelegramAttachmentReadError({
        attachmentId: args.attachmentId,
        reason: "too_large",
        maxBytes: args.input.maxBytes,
        sizeBytes: contentLength,
      }),
    );
  }

  return Result.ok({
    chunks: response.value.body,
    filename: args.filename,
    mimeType: args.mimeType,
    sizeBytes: sizeBytes ?? contentLength,
  });
}

function readContentLength(headers: Headers): number | undefined {
  const value = headers.get("content-length");
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function largestTelegramPhoto(photos: readonly TelegramPhotoRef[]): TelegramPhotoRef | undefined {
  return photos.reduce<TelegramPhotoRef | undefined>((selected, photo) => {
    if (selected === undefined) return photo;
    return telegramPhotoScore(photo) > telegramPhotoScore(selected) ? photo : selected;
  }, undefined);
}

function telegramPhotoScore(photo: TelegramPhotoRef): number {
  return photo.file_size ?? photo.width * photo.height;
}

function kindFromDocument(document: TelegramDocumentRef): ChatAttachmentKind {
  const mimeType = document.mime_type?.toLowerCase();
  const filename = document.file_name?.toLowerCase();

  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType?.startsWith("audio/")) return "audio";
  if (mimeType?.startsWith("video/")) return "video";
  if (isArchiveMimeType(mimeType) || isArchiveFilename(filename)) return "archive";
  return "document";
}

function isArchiveMimeType(mimeType: string | undefined): boolean {
  return (
    mimeType === "application/zip" ||
    mimeType === "application/x-7z-compressed" ||
    mimeType === "application/x-rar-compressed" ||
    mimeType === "application/gzip" ||
    mimeType === "application/x-tar"
  );
}

function isArchiveFilename(filename: string | undefined): boolean {
  return (
    filename?.endsWith(".zip") === true ||
    filename?.endsWith(".7z") === true ||
    filename?.endsWith(".rar") === true ||
    filename?.endsWith(".tar") === true ||
    filename?.endsWith(".tar.gz") === true ||
    filename?.endsWith(".tgz") === true
  );
}

function decodeTelegramAdapterData(args: {
  readonly chatId: number | string;
  readonly messageId?: number;
  readonly fileId?: string;
  readonly fileUniqueId?: string;
  readonly raw: unknown;
  readonly updateId?: number;
}): TelegramAdapterData {
  return {
    telegramChatId: String(args.chatId),
    telegramMessageId: args.messageId,
    telegramFileId: args.fileId,
    telegramFileUniqueId: args.fileUniqueId,
    updateId: args.updateId,
    raw: args.raw,
  };
}

type TelegramFileRef = {
  readonly file_id: string;
  readonly file_unique_id?: string;
  readonly file_size?: number;
};

type TelegramPhotoRef = TelegramFileRef & {
  readonly width: number;
  readonly height: number;
};

type TelegramDocumentRef = TelegramFileRef & {
  readonly file_name?: string;
  readonly mime_type?: string;
};

type TelegramActorChat = {
  readonly id: number | string;
  readonly title?: string;
  readonly first_name?: string;
  readonly last_name?: string;
  readonly username?: string;
};

type TelegramActorUser = TelegramTextMessageContext["from"];

function decodeTelegramActor(args: {
  readonly chat: TelegramActorChat;
  readonly from: TelegramActorUser;
  readonly adapterData: TelegramAdapterData;
}): ChatActor {
  if (args.from === undefined) {
    return {
      kind: "system",
      actorId: String(args.chat.id),
      displayName: formatTelegramChatName(args.chat),
      adapterData: args.adapterData,
    };
  }

  return {
    kind: args.from.is_bot ? "bot" : "user",
    actorId: String(args.from.id),
    displayName: formatTelegramDisplayName(args.from),
    adapterData: args.adapterData,
  };
}

function formatTelegramDisplayName(from: NonNullable<TelegramActorUser>): string {
  return (
    [from.first_name, from.last_name].filter(Boolean).join(" ") || from.username || String(from.id)
  );
}

function formatTelegramChatName(chat: TelegramActorChat): string | undefined {
  return (
    chat.title ?? ([chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username)
  );
}
