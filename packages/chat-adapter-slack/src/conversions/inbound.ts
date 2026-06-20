import { Result } from "better-result";
import type {
  ChatActor,
  ChatAdapterMessageEvent,
  ChatAttachment,
  ChatAttachmentContent,
  ChatAttachmentKind,
} from "@xmux/chat-core";
import type {
  SlackAppMentionEvent,
  SlackBotClient,
  SlackBotIdentity,
  SlackMessageEvent,
} from "../client";
import { createSlackConversationId } from "../conversation";
import { SlackAttachmentReadError, type SlackAdapterError } from "../errors";
import type { SlackAdapterData, SlackConversationScope } from "../types";
import { unescapeSlackText } from "./formatting";

export type SlackInboundDecodeResult<TEvent> =
  | { readonly status: "event"; readonly event: TEvent }
  | {
      readonly status: "ignored";
      readonly reason:
        | "bot_message"
        | "ignored_subtype"
        | "message_changed"
        | "missing_channel_or_ts"
        | "self_message"
        | "unsupported_message";
    };

export interface SlackMessageFile {
  readonly id?: string;
  readonly mimetype?: string;
  readonly filetype?: string;
  readonly url_private?: string;
  readonly url_private_download?: string;
  readonly name?: string;
  readonly title?: string;
  readonly size?: number;
  readonly original_w?: number;
  readonly original_h?: number;
}

export interface SlackMessageLike {
  readonly type: string;
  readonly subtype?: string;
  readonly channel?: string;
  readonly channel_type?: string;
  readonly ts?: string;
  readonly thread_ts?: string;
  readonly text?: string;
  readonly user?: string;
  readonly username?: string;
  readonly bot_id?: string;
  readonly team?: string;
  readonly team_id?: string;
  readonly enterprise_id?: string;
  readonly files?: readonly SlackMessageFile[];
}

const ignoredMessageSubtypes = new Set([
  "message_deleted",
  "message_replied",
  "channel_join",
  "channel_leave",
  "channel_topic",
  "channel_purpose",
  "channel_name",
  "channel_archive",
  "channel_unarchive",
  "group_join",
  "group_leave",
  "group_topic",
  "group_purpose",
  "group_name",
  "group_archive",
  "group_unarchive",
  "ekm_access_denied",
  "tombstone",
]);

export function decodeSlackMessageEvent<TChatId extends string>(args: {
  readonly chatId: TChatId;
  readonly client: SlackBotClient;
  readonly event: SlackMessageEvent["event"] | SlackAppMentionEvent["event"];
  readonly botIdentity?: SlackBotIdentity;
  readonly conversationScope?: SlackConversationScope;
}): SlackInboundDecodeResult<
  ChatAdapterMessageEvent<TChatId, SlackAdapterData, SlackAdapterError>
> {
  const event = args.event as SlackMessageLike;

  if (event.type !== "message" && event.type !== "app_mention") {
    return { status: "ignored", reason: "unsupported_message" };
  }

  if (event.subtype === "message_changed") {
    return { status: "ignored", reason: "message_changed" };
  }

  if (event.subtype !== undefined && ignoredMessageSubtypes.has(event.subtype)) {
    return { status: "ignored", reason: "ignored_subtype" };
  }

  if (isSelfMessage({ event, botIdentity: args.botIdentity })) {
    return { status: "ignored", reason: "self_message" };
  }

  if (event.bot_id !== undefined) {
    return { status: "ignored", reason: "bot_message" };
  }

  if (event.channel === undefined || event.ts === undefined) {
    return { status: "ignored", reason: "missing_channel_or_ts" };
  }

  const adapterData = createSlackMessageAdapterData(event);
  const conversation = {
    chatId: args.chatId,
    conversationId: createSlackConversationId({
      conversationScope: args.conversationScope ?? "channel",
      channelId: event.channel,
      threadTs: event.thread_ts,
      messageTs: event.ts,
    }),
  };

  return {
    status: "event",
    event: {
      type: "message",
      chatId: args.chatId,
      conversation,
      message: {
        ...conversation,
        messageId: event.ts,
        text: normalizeSlackInboundText(event.text ?? ""),
        format: "plain",
        actor: createSlackMessageActor(event, adapterData),
        attachments: (event.files ?? []).map((file) =>
          createSlackAttachment({ client: args.client, event, file }),
        ),
        adapterData,
      },
    },
  };
}

export function isSelfMessage(args: {
  readonly event: SlackMessageLike;
  readonly botIdentity?: SlackBotIdentity;
}): boolean {
  return (
    (args.botIdentity?.botUserId !== undefined && args.event.user === args.botIdentity.botUserId) ||
    (args.botIdentity?.botId !== undefined && args.event.bot_id === args.botIdentity.botId)
  );
}

function normalizeSlackInboundText(text: string): string {
  return unescapeSlackText(text)
    .replace(/<@([A-Z0-9_]+)\|([^<>]+)>/g, "@$2")
    .replace(/<@([A-Z0-9_]+)>/g, "@$1")
    .replace(/<#([A-Z0-9_]+)\|([^<>]+)>/g, "#$2")
    .replace(/<#([A-Z0-9_]+)>/g, "#$1")
    .replace(/<(https?:\/\/[^|<>]+)\|([^<>]+)>/g, "$2")
    .replace(/<(https?:\/\/[^<>]+)>/g, "$1");
}

function createSlackMessageActor(
  event: SlackMessageLike,
  adapterData: SlackAdapterData,
): ChatActor {
  if (event.user !== undefined) {
    return {
      kind: "user",
      actorId: event.user,
      ...(event.username === undefined ? {} : { displayName: event.username }),
      adapterData,
    };
  }

  if (event.bot_id !== undefined) {
    return {
      kind: "bot",
      actorId: event.bot_id,
      ...(event.username === undefined ? {} : { displayName: event.username }),
      adapterData,
    };
  }

  return {
    kind: "system",
    adapterData,
  };
}

function createSlackMessageAdapterData(event: SlackMessageLike): SlackAdapterData {
  return {
    slackTeamId: event.team_id ?? event.team,
    slackEnterpriseId: event.enterprise_id,
    slackChannelId: event.channel ?? "",
    slackMessageTs: event.ts,
    slackThreadTs: event.thread_ts ?? event.ts,
    slackUserId: event.user,
    slackBotId: event.bot_id,
    raw: event,
  };
}

function createSlackAttachment(args: {
  readonly client: SlackBotClient;
  readonly event: SlackMessageLike;
  readonly file: SlackMessageFile;
}): ChatAttachment<SlackAdapterData, SlackAdapterError> {
  const attachmentId =
    args.file.id ?? args.file.url_private_download ?? args.file.url_private ?? "slack-file";
  const filename = args.file.name ?? args.file.title;
  const adapterData: SlackAdapterData = {
    slackTeamId: args.event.team_id ?? args.event.team,
    slackEnterpriseId: args.event.enterprise_id,
    slackChannelId: args.event.channel ?? "",
    slackMessageTs: args.event.ts,
    slackThreadTs: args.event.thread_ts ?? args.event.ts,
    slackUserId: args.event.user,
    slackBotId: args.event.bot_id,
    slackFileId: args.file.id,
    raw: args.file,
  };

  return {
    attachmentId,
    kind: kindFromSlackFile(args.file),
    disposition: isInlineSlackFile(args.file) ? "inline" : "attachment",
    filename,
    mimeType: args.file.mimetype,
    sizeBytes: args.file.size,
    adapterData,
    open: (input) =>
      openSlackAttachment({
        client: args.client,
        attachmentId,
        file: args.file,
        filename,
        input,
      }),
  };
}

async function openSlackAttachment(args: {
  readonly client: SlackBotClient;
  readonly attachmentId: string;
  readonly file: SlackMessageFile;
  readonly filename?: string;
  readonly input?: { readonly signal?: AbortSignal; readonly maxBytes?: number };
}): Promise<Result<ChatAttachmentContent, SlackAdapterError>> {
  if (
    args.input?.maxBytes !== undefined &&
    args.file.size !== undefined &&
    args.file.size > args.input.maxBytes
  ) {
    return Result.err(
      new SlackAttachmentReadError({
        attachmentId: args.attachmentId,
        reason: "too_large",
        maxBytes: args.input.maxBytes,
        sizeBytes: args.file.size,
      }),
    );
  }

  const url = args.file.url_private_download ?? args.file.url_private;
  if (url === undefined || url.length === 0) {
    return Result.err(
      new SlackAttachmentReadError({
        attachmentId: args.attachmentId,
        reason: "invalid_response",
        sizeBytes: args.file.size,
        cause: "Slack file is missing a private download URL",
      }),
    );
  }

  const response = await Result.tryPromise({
    try: () => args.client.downloadFile({ url, signal: args.input?.signal }),
    catch: (cause) =>
      new SlackAttachmentReadError({
        attachmentId: args.attachmentId,
        reason: "download",
        sizeBytes: args.file.size,
        cause,
      }),
  });
  if (response.isErr()) return Result.err(response.error);

  if (!response.value.ok) {
    return Result.err(
      new SlackAttachmentReadError({
        attachmentId: args.attachmentId,
        reason: "invalid_response",
        sizeBytes: args.file.size,
        cause: response.value.statusText || response.value.status,
      }),
    );
  }

  const contentType = response.value.headers.get("content-type") ?? undefined;
  if (contentType?.toLowerCase().includes("text/html") === true) {
    return Result.err(
      new SlackAttachmentReadError({
        attachmentId: args.attachmentId,
        reason: "invalid_response",
        sizeBytes: args.file.size,
        cause:
          "Slack returned HTML instead of file bytes; ensure the app has the files:read OAuth scope",
      }),
    );
  }

  if (response.value.body === null) {
    return Result.err(
      new SlackAttachmentReadError({
        attachmentId: args.attachmentId,
        reason: "missing_body",
        sizeBytes: args.file.size,
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
      new SlackAttachmentReadError({
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
    mimeType: args.file.mimetype ?? contentType,
    sizeBytes: args.file.size ?? contentLength,
  });
}

function readContentLength(headers: Headers): number | undefined {
  const value = headers.get("content-length");
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function kindFromSlackFile(file: SlackMessageFile): ChatAttachmentKind {
  const mimeType = file.mimetype?.toLowerCase();
  const filetype = file.filetype?.toLowerCase();
  const filename = file.name?.toLowerCase() ?? file.title?.toLowerCase() ?? "";

  if (mimeType?.startsWith("image/") === true) return "image";
  if (mimeType?.startsWith("audio/") === true) return "audio";
  if (mimeType?.startsWith("video/") === true) return "video";
  if (
    mimeType === "application/zip" ||
    mimeType === "application/x-tar" ||
    mimeType === "application/gzip" ||
    filetype === "zip" ||
    filetype === "tar" ||
    filetype === "gzip" ||
    /\.(zip|tar|tgz|gz)$/i.test(filename)
  ) {
    return "archive";
  }

  if (mimeType !== undefined) return "document";
  return "other";
}

function isInlineSlackFile(file: SlackMessageFile): boolean {
  return file.mimetype?.startsWith("image/") === true;
}
