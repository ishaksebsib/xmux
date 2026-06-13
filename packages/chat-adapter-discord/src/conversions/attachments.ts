import { Result } from "better-result";
import type { ChatAttachment, ChatAttachmentContent, ChatAttachmentKind } from "@xmux/chat-core";
import type { DiscordBotClient } from "../client";
import { DiscordAttachmentReadError, type DiscordAdapterError } from "../errors";
import type { DiscordAdapterData } from "../types";

export interface DiscordAttachmentLike {
  readonly id?: string;
  readonly url?: string;
  readonly name?: string | null;
  readonly filename?: string | null;
  readonly contentType?: string | null;
  readonly content_type?: string | null;
  readonly size?: number | null;
}

export function decodeDiscordAttachments(args: {
  readonly client: Pick<DiscordBotClient, "downloadAttachment">;
  readonly channelId: string;
  readonly guildId?: string;
  readonly messageId: string;
  readonly attachments: unknown;
}): readonly ChatAttachment<DiscordAdapterData, DiscordAdapterError>[] {
  return Array.from(iterateDiscordAttachments(args.attachments))
    .map((attachment, index) =>
      createDiscordAttachment({
        client: args.client,
        channelId: args.channelId,
        guildId: args.guildId,
        messageId: args.messageId,
        attachment,
        fallbackId: `attachment-${index + 1}`,
      }),
    )
    .filter(
      (attachment): attachment is ChatAttachment<DiscordAdapterData, DiscordAdapterError> =>
        attachment !== undefined,
    );
}

export function kindFromDiscordAttachment(args: {
  readonly mimeType?: string;
  readonly filename?: string;
}): ChatAttachmentKind {
  const mimeType = args.mimeType?.toLowerCase();
  const filename = args.filename?.toLowerCase();

  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType?.startsWith("audio/")) return "audio";
  if (mimeType?.startsWith("video/")) return "video";
  if (isArchiveMimeType(mimeType) || isArchiveFilename(filename)) return "archive";
  if (mimeType !== undefined || filename !== undefined) return "document";
  return "other";
}

function createDiscordAttachment(args: {
  readonly client: Pick<DiscordBotClient, "downloadAttachment">;
  readonly channelId: string;
  readonly guildId?: string;
  readonly messageId: string;
  readonly attachment: DiscordAttachmentLike;
  readonly fallbackId: string;
}): ChatAttachment<DiscordAdapterData, DiscordAdapterError> | undefined {
  const url = args.attachment.url;
  if (typeof url !== "string" || url.length === 0) {
    return undefined;
  }

  const attachmentId =
    typeof args.attachment.id === "string" && args.attachment.id.length > 0
      ? args.attachment.id
      : args.fallbackId;
  const filename = args.attachment.name ?? args.attachment.filename ?? undefined;
  const mimeType = args.attachment.contentType ?? args.attachment.content_type ?? undefined;
  const sizeBytes =
    typeof args.attachment.size === "number" && Number.isSafeInteger(args.attachment.size)
      ? args.attachment.size
      : undefined;
  const adapterData: DiscordAdapterData = {
    discordGuildId: args.guildId,
    discordChannelId: args.channelId,
    discordMessageId: args.messageId,
    discordAttachmentId: attachmentId,
    raw: args.attachment,
  };

  return {
    attachmentId,
    kind: kindFromDiscordAttachment({ mimeType, filename }),
    disposition: mimeType?.startsWith("image/") === true ? "inline" : "attachment",
    filename,
    mimeType,
    sizeBytes,
    adapterData,
    open: (input) =>
      openDiscordAttachment({
        client: args.client,
        attachmentId,
        url,
        filename,
        mimeType,
        sizeBytes,
        input,
      }),
  };
}

async function openDiscordAttachment(args: {
  readonly client: Pick<DiscordBotClient, "downloadAttachment">;
  readonly attachmentId: string;
  readonly url: string;
  readonly filename?: string;
  readonly mimeType?: string;
  readonly sizeBytes?: number;
  readonly input?: { readonly signal?: AbortSignal; readonly maxBytes?: number };
}): Promise<Result<ChatAttachmentContent, DiscordAdapterError>> {
  if (
    args.input?.maxBytes !== undefined &&
    args.sizeBytes !== undefined &&
    args.sizeBytes > args.input.maxBytes
  ) {
    return Result.err(
      new DiscordAttachmentReadError({
        attachmentId: args.attachmentId,
        reason: "too_large",
        maxBytes: args.input.maxBytes,
        sizeBytes: args.sizeBytes,
      }),
    );
  }

  const response = await Result.tryPromise({
    try: () => args.client.downloadAttachment({ url: args.url, signal: args.input?.signal }),
    catch: (cause) =>
      new DiscordAttachmentReadError({
        attachmentId: args.attachmentId,
        reason: "download",
        sizeBytes: args.sizeBytes,
        cause,
      }),
  });
  if (response.isErr()) return Result.err(response.error);

  if (!response.value.ok) {
    return Result.err(
      new DiscordAttachmentReadError({
        attachmentId: args.attachmentId,
        reason: "invalid_response",
        sizeBytes: args.sizeBytes,
        cause: response.value.statusText || response.value.status,
      }),
    );
  }

  if (response.value.body === null) {
    return Result.err(
      new DiscordAttachmentReadError({
        attachmentId: args.attachmentId,
        reason: "missing_body",
        sizeBytes: args.sizeBytes,
      }),
    );
  }

  const contentLength = readContentLength(response.value.headers);
  if (
    args.input?.maxBytes !== undefined &&
    contentLength !== undefined &&
    contentLength > args.input.maxBytes
  ) {
    return Result.err(
      new DiscordAttachmentReadError({
        attachmentId: args.attachmentId,
        reason: "too_large",
        maxBytes: args.input.maxBytes,
        sizeBytes: contentLength,
      }),
    );
  }

  const sizeBytes = args.sizeBytes ?? contentLength;
  const mimeType = args.mimeType ?? readContentType(response.value.headers);
  const chunks = response.value.body as AsyncIterable<Uint8Array>;

  return Result.ok({
    chunks:
      args.input?.maxBytes === undefined
        ? chunks
        : enforceDiscordAttachmentByteLimit({
            chunks,
            attachmentId: args.attachmentId,
            maxBytes: args.input.maxBytes,
          }),
    filename: args.filename,
    mimeType,
    sizeBytes,
  });
}

async function* enforceDiscordAttachmentByteLimit(args: {
  readonly chunks: AsyncIterable<Uint8Array>;
  readonly attachmentId: string;
  readonly maxBytes: number;
}): AsyncIterable<Uint8Array> {
  let sizeBytes = 0;
  for await (const chunk of args.chunks) {
    sizeBytes += chunk.byteLength;
    if (sizeBytes > args.maxBytes) {
      throw new DiscordAttachmentReadError({
        attachmentId: args.attachmentId,
        reason: "too_large",
        maxBytes: args.maxBytes,
        sizeBytes,
      });
    }
    yield chunk;
  }
}

function* iterateDiscordAttachments(value: unknown): Iterable<DiscordAttachmentLike> {
  if (value === undefined || value === null) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (isRecord(item)) yield item;
    }
    return;
  }

  if (isRecord(value) && typeof value.values === "function") {
    for (const item of value.values() as Iterable<unknown>) {
      if (isRecord(item)) yield item;
    }
    return;
  }

  if (isRecord(value)) {
    for (const item of Object.values(value)) {
      if (isRecord(item)) yield item;
    }
  }
}

function readContentLength(headers: Headers): number | undefined {
  const value = headers.get("content-length");
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function readContentType(headers: Headers): string | undefined {
  return headers.get("content-type") ?? undefined;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
