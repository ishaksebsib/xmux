import {
  App,
  type AllMiddlewareArgs,
  type SlackActionMiddlewareArgs,
  type SlackCommandMiddlewareArgs,
  type SlackEventMiddlewareArgs,
} from "@slack/bolt";
import type {
  AuthTestResponse,
  ChatAppendStreamArguments,
  ChatAppendStreamResponse,
  ChatPostEphemeralArguments,
  ChatPostEphemeralResponse,
  ChatPostMessageArguments,
  ChatPostMessageResponse,
  ChatStartStreamArguments,
  ChatStartStreamResponse,
  ChatStopStreamArguments,
  ChatStopStreamResponse,
  ChatUpdateArguments,
  ChatUpdateResponse,
  FilesInfoArguments,
  FilesInfoResponse,
} from "@slack/web-api";
import type { SlackAdapterConfigMode, SlackBotToken } from "./config";
import type { SlackBlock, SlackClientOptions, SlackMessageMetadata } from "./types";

type SlackBoltMessageArgs = SlackEventMiddlewareArgs<"message"> & AllMiddlewareArgs;
type SlackBoltAppMentionArgs = SlackEventMiddlewareArgs<"app_mention"> & AllMiddlewareArgs;
type SlackBoltCommandArgs = SlackCommandMiddlewareArgs & AllMiddlewareArgs;
type SlackBoltActionArgs = SlackActionMiddlewareArgs & AllMiddlewareArgs;
type SlackBoltReactionAddedArgs = SlackEventMiddlewareArgs<"reaction_added"> & AllMiddlewareArgs;
type SlackBoltReactionRemovedArgs = SlackEventMiddlewareArgs<"reaction_removed"> &
  AllMiddlewareArgs;

export type SlackMessageHandler = (event: SlackMessageEvent) => void | Promise<void>;
export type SlackAppMentionHandler = (event: SlackAppMentionEvent) => void | Promise<void>;
export type SlackCommandHandler = (event: SlackCommandEvent) => void | Promise<void>;
export type SlackActionHandler = (event: SlackActionEvent) => void | Promise<void>;
export type SlackReactionHandler = (event: SlackReactionEvent) => void | Promise<void>;
export type SlackErrorHandler = (error: unknown) => void | Promise<void>;

export interface SlackRetryMetadata {
  readonly retryNum?: number;
  readonly retryReason?: string;
}

export interface SlackMessageEvent extends SlackRetryMetadata {
  readonly event: SlackBoltMessageArgs["event"];
  readonly body: SlackBoltMessageArgs["body"];
  readonly raw: SlackBoltMessageArgs;
}

export interface SlackAppMentionEvent extends SlackRetryMetadata {
  readonly event: SlackBoltAppMentionArgs["event"];
  readonly body: SlackBoltAppMentionArgs["body"];
  readonly raw: SlackBoltAppMentionArgs;
}

export interface SlackCommandEvent extends SlackRetryMetadata {
  readonly payload: SlackBoltCommandArgs["command"];
  readonly ack: () => Promise<void>;
  readonly respond: SlackBoltCommandArgs["respond"];
  readonly raw: SlackBoltCommandArgs;
}

export interface SlackActionEvent extends SlackRetryMetadata {
  readonly payload: SlackBoltActionArgs["payload"];
  readonly action: SlackBoltActionArgs["action"];
  readonly body: SlackBoltActionArgs["body"];
  readonly ack: () => Promise<void>;
  readonly respond: SlackBoltActionArgs["respond"];
  readonly raw: SlackBoltActionArgs;
}

export interface SlackReactionEvent extends SlackRetryMetadata {
  readonly event: SlackBoltReactionAddedArgs["event"] | SlackBoltReactionRemovedArgs["event"];
  readonly body: SlackBoltReactionAddedArgs["body"] | SlackBoltReactionRemovedArgs["body"];
  readonly raw: SlackBoltReactionAddedArgs | SlackBoltReactionRemovedArgs;
}

export interface SlackPostMessageRequest {
  readonly channel: string;
  readonly text?: string;
  readonly markdown_text?: string;
  readonly mrkdwn?: boolean;
  readonly blocks?: readonly SlackBlock[];
  readonly metadata?: SlackMessageMetadata;
  readonly unfurl_links?: boolean;
  readonly unfurl_media?: boolean;
  readonly thread_ts?: string;
  readonly reply_broadcast?: boolean;
  readonly signal?: AbortSignal;
}

export interface SlackUpdateMessageRequest {
  readonly channel: string;
  readonly ts: string;
  readonly text?: string;
  readonly markdown_text?: string;
  readonly mrkdwn?: boolean;
  readonly blocks?: readonly SlackBlock[];
  readonly metadata?: SlackMessageMetadata;
  readonly link_names?: boolean;
  readonly parse?: "full" | "none";
  readonly reply_broadcast?: boolean;
  readonly signal?: AbortSignal;
}

export interface SlackPostEphemeralRequest {
  readonly channel: string;
  readonly user: string;
  readonly text?: string;
  readonly markdown_text?: string;
  readonly blocks?: readonly SlackBlock[];
  readonly thread_ts?: string;
  readonly signal?: AbortSignal;
}

export type SlackNativeStreamChunk = NonNullable<ChatStartStreamArguments["chunks"]>[number];

export interface SlackStartStreamRequest {
  readonly channel: string;
  readonly thread_ts: string;
  readonly markdown_text?: string;
  readonly chunks?: readonly SlackNativeStreamChunk[];
  readonly recipient_team_id?: string;
  readonly recipient_user_id?: string;
  readonly task_display_mode?: string;
  readonly signal?: AbortSignal;
}

export interface SlackAppendStreamRequest {
  readonly channel: string;
  readonly ts: string;
  readonly markdown_text?: string;
  readonly chunks?: readonly SlackNativeStreamChunk[];
  readonly signal?: AbortSignal;
}

export interface SlackStopStreamRequest {
  readonly channel: string;
  readonly ts: string;
  /** Local-only preservation of the parent thread target; not sent to Slack. */
  readonly thread_ts?: string;
  readonly markdown_text?: string;
  readonly chunks?: readonly SlackNativeStreamChunk[];
  readonly blocks?: readonly SlackBlock[];
  readonly metadata?: SlackMessageMetadata;
  readonly signal?: AbortSignal;
}

export interface SlackOpenFileRequest {
  readonly fileId: string;
  readonly signal?: AbortSignal;
}

export interface SlackDownloadFileRequest {
  readonly url: string;
  readonly signal?: AbortSignal;
}

export interface SlackBotIdentity {
  readonly botUserId?: string;
  readonly botId?: string;
  readonly teamId?: string;
  readonly enterpriseId?: string;
  readonly raw: unknown;
}

export interface SlackSentMessage {
  readonly channelId: string;
  readonly messageTs: string;
  readonly threadTs?: string;
  readonly teamId?: string;
  readonly raw: unknown;
}

export interface SlackBotClient {
  start(): Promise<void>;
  stop(): Promise<void>;
  onMessage(handler: SlackMessageHandler): void;
  onAppMention(handler: SlackAppMentionHandler): void;
  onCommand(handler: SlackCommandHandler): void;
  onAction(handler: SlackActionHandler): void;
  onReactionAdded(handler: SlackReactionHandler): void;
  onReactionRemoved(handler: SlackReactionHandler): void;
  onError(handler: SlackErrorHandler): void;
  postMessage(input: SlackPostMessageRequest): Promise<SlackSentMessage>;
  updateMessage(input: SlackUpdateMessageRequest): Promise<SlackSentMessage>;
  postEphemeral(input: SlackPostEphemeralRequest): Promise<SlackSentMessage>;
  startStream(input: SlackStartStreamRequest): Promise<SlackSentMessage>;
  appendStream(input: SlackAppendStreamRequest): Promise<SlackSentMessage>;
  stopStream(input: SlackStopStreamRequest): Promise<SlackSentMessage>;
  openFile(input: SlackOpenFileRequest): Promise<FilesInfoResponse>;
  downloadFile(input: SlackDownloadFileRequest): Promise<Response>;
  getBotIdentity(): Promise<SlackBotIdentity>;
}

export type CreateSlackBotClient = (args: {
  readonly botToken: SlackBotToken;
  readonly mode: SlackAdapterConfigMode;
  readonly options?: SlackClientOptions;
}) => SlackBotClient;

export function createSlackBotClient(args: {
  readonly botToken: SlackBotToken;
  readonly mode: SlackAdapterConfigMode;
  readonly options?: SlackClientOptions;
}): SlackBotClient {
  const app = new App(createBoltAppOptions(args));

  return {
    start: async () => {
      await app.start();
    },
    stop: async () => {
      await app.stop();
    },
    onMessage: (handler) => {
      app.message(async (event) => {
        await handler({
          event: event.event,
          body: event.body,
          raw: event,
          ...retryMetadata(event),
        });
      });
    },
    onAppMention: (handler) => {
      app.event("app_mention", async (event) => {
        await handler({
          event: event.event,
          body: event.body,
          raw: event,
          ...retryMetadata(event),
        });
      });
    },
    onCommand: (handler) => {
      app.command(/.*/, async (event) => {
        await handler({
          payload: event.command,
          ack: () => event.ack(),
          respond: event.respond,
          raw: event,
          ...retryMetadata(event),
        });
      });
    },
    onAction: (handler) => {
      app.action(/.*/, async (event) => {
        await handler({
          payload: event.payload,
          action: event.action,
          body: event.body,
          ack: () => event.ack(),
          respond: event.respond,
          raw: event,
          ...retryMetadata(event),
        });
      });
    },
    onReactionAdded: (handler) => {
      app.event("reaction_added", async (event) => {
        await handler({
          event: event.event,
          body: event.body,
          raw: event,
          ...retryMetadata(event),
        });
      });
    },
    onReactionRemoved: (handler) => {
      app.event("reaction_removed", async (event) => {
        await handler({
          event: event.event,
          body: event.body,
          raw: event,
          ...retryMetadata(event),
        });
      });
    },
    onError: (handler) => {
      app.error(async (error) => {
        await handler(error);
      });
    },
    postMessage: async (input) => {
      const response = await app.client.chat.postMessage(toChatPostMessageArguments(input));
      return encodePostMessageResponse(input, response);
    },
    updateMessage: async (input) => {
      const response = await app.client.chat.update(toChatUpdateArguments(input));
      return encodeUpdateMessageResponse(input, response);
    },
    postEphemeral: async (input) => {
      const response = await app.client.chat.postEphemeral(toChatPostEphemeralArguments(input));
      return encodePostEphemeralResponse(input, response);
    },
    startStream: async (input) => {
      const response = await app.client.chat.startStream(toChatStartStreamArguments(input));
      return encodeStartStreamResponse(input, response);
    },
    appendStream: async (input) => {
      const response = await app.client.chat.appendStream(toChatAppendStreamArguments(input));
      return encodeAppendStreamResponse(input, response);
    },
    stopStream: async (input) => {
      const response = await app.client.chat.stopStream(toChatStopStreamArguments(input));
      return encodeStopStreamResponse(input, response);
    },
    openFile: (input) => app.client.files.info(toFilesInfoArguments(input)),
    downloadFile: (input) =>
      fetch(input.url, {
        headers: { Authorization: `Bearer ${args.botToken}` },
        signal: input.signal,
      }),
    getBotIdentity: async () => encodeAuthTestResponse(await app.client.auth.test()),
  };
}

function createBoltAppOptions(args: {
  readonly botToken: SlackBotToken;
  readonly mode: SlackAdapterConfigMode;
  readonly options?: SlackClientOptions;
}): ConstructorParameters<typeof App>[0] {
  const credentials =
    args.mode.type === "socket"
      ? { appToken: args.mode.appToken, socketMode: true }
      : { signingSecret: args.mode.signingSecret, socketMode: false };

  return {
    ...args.options,
    ...credentials,
    token: args.botToken,
  };
}

function toChatPostMessageArguments(input: SlackPostMessageRequest): ChatPostMessageArguments {
  const base = removeUndefined({
    channel: input.channel,
    text: input.text,
    markdown_text: input.markdown_text,
    mrkdwn: input.mrkdwn,
    metadata: input.metadata,
    unfurl_links: input.unfurl_links,
    unfurl_media: input.unfurl_media,
    thread_ts: input.thread_ts,
    reply_broadcast: input.reply_broadcast,
  });

  return (
    input.blocks === undefined ? base : { ...base, blocks: mutableBlocks(input.blocks) }
  ) as ChatPostMessageArguments;
}

function toChatUpdateArguments(input: SlackUpdateMessageRequest): ChatUpdateArguments {
  const base = removeUndefined({
    channel: input.channel,
    ts: input.ts,
    text: input.text,
    markdown_text: input.markdown_text,
    mrkdwn: input.mrkdwn,
    metadata: input.metadata,
    link_names: input.link_names,
    parse: input.parse,
    reply_broadcast: input.reply_broadcast,
  });

  return (
    input.blocks === undefined ? base : { ...base, blocks: mutableBlocks(input.blocks) }
  ) as ChatUpdateArguments;
}

function toChatPostEphemeralArguments(
  input: SlackPostEphemeralRequest,
): ChatPostEphemeralArguments {
  const base = removeUndefined({
    channel: input.channel,
    user: input.user,
    text: input.text,
    markdown_text: input.markdown_text,
    thread_ts: input.thread_ts,
  });

  return (
    input.blocks === undefined ? base : { ...base, blocks: mutableBlocks(input.blocks) }
  ) as ChatPostEphemeralArguments;
}

function toChatStartStreamArguments(input: SlackStartStreamRequest): ChatStartStreamArguments {
  const base = removeUndefined({
    channel: input.channel,
    thread_ts: input.thread_ts,
    markdown_text: input.markdown_text,
    recipient_team_id: input.recipient_team_id,
    recipient_user_id: input.recipient_user_id,
    task_display_mode: input.task_display_mode,
  });

  return (
    input.chunks === undefined ? base : { ...base, chunks: mutableChunks(input.chunks) }
  ) as ChatStartStreamArguments;
}

function toChatAppendStreamArguments(input: SlackAppendStreamRequest): ChatAppendStreamArguments {
  const base = removeUndefined({
    channel: input.channel,
    ts: input.ts,
    markdown_text: input.markdown_text,
  });

  return (
    input.chunks === undefined ? base : { ...base, chunks: mutableChunks(input.chunks) }
  ) as ChatAppendStreamArguments;
}

function toChatStopStreamArguments(input: SlackStopStreamRequest): ChatStopStreamArguments {
  const base = removeUndefined({
    channel: input.channel,
    ts: input.ts,
    markdown_text: input.markdown_text,
    metadata: input.metadata,
  });
  const withChunks =
    input.chunks === undefined ? base : { ...base, chunks: mutableChunks(input.chunks) };

  return (
    input.blocks === undefined ? withChunks : { ...withChunks, blocks: mutableBlocks(input.blocks) }
  ) as ChatStopStreamArguments;
}

function toFilesInfoArguments(input: SlackOpenFileRequest): FilesInfoArguments {
  return { file: input.fileId };
}

function mutableBlocks(blocks: readonly SlackBlock[]): SlackBlock[] {
  return [...blocks];
}

function mutableChunks(
  chunks: readonly SlackNativeStreamChunk[],
): NonNullable<ChatStartStreamArguments["chunks"]> {
  return [...chunks];
}

function retryMetadata(event: { readonly context?: SlackRetryMetadata }): SlackRetryMetadata {
  return {
    retryNum: event.context?.retryNum,
    retryReason: event.context?.retryReason,
  };
}

function encodeAuthTestResponse(response: AuthTestResponse): SlackBotIdentity {
  return {
    botUserId: response.user_id ?? response.user,
    botId: response.bot_id,
    teamId: response.team_id,
    enterpriseId: response.enterprise_id,
    raw: response,
  };
}

function encodePostMessageResponse(
  input: SlackPostMessageRequest,
  response: ChatPostMessageResponse,
): SlackSentMessage {
  const messageTs = response.ts ?? response.message?.ts;
  if (messageTs === undefined) {
    throw new Error("Slack chat.postMessage response did not include a message timestamp");
  }

  const channelId = response.channel ?? input.channel;

  return {
    channelId,
    messageTs,
    threadTs: response.message?.thread_ts ?? input.thread_ts,
    teamId: response.message?.team,
    raw: response,
  };
}

function encodeUpdateMessageResponse(
  input: SlackUpdateMessageRequest,
  response: ChatUpdateResponse,
): SlackSentMessage {
  const messageTs = response.ts ?? input.ts;
  const channelId = response.channel ?? input.channel;

  return {
    channelId,
    messageTs,
    threadTs: undefined,
    teamId: response.message?.team,
    raw: response,
  };
}

function encodePostEphemeralResponse(
  input: SlackPostEphemeralRequest,
  response: ChatPostEphemeralResponse,
): SlackSentMessage {
  if (response.message_ts === undefined) {
    throw new Error("Slack chat.postEphemeral response did not include a message timestamp");
  }

  return {
    channelId: input.channel,
    messageTs: response.message_ts,
    threadTs: input.thread_ts,
    raw: response,
  };
}

function encodeStartStreamResponse(
  input: SlackStartStreamRequest,
  response: ChatStartStreamResponse,
): SlackSentMessage {
  const messageTs = response.ts;
  if (messageTs === undefined) {
    throw new Error("Slack chat.startStream response did not include a message timestamp");
  }

  return {
    channelId: response.channel ?? input.channel,
    messageTs,
    threadTs: input.thread_ts,
    raw: response,
  };
}

function encodeAppendStreamResponse(
  input: SlackAppendStreamRequest,
  response: ChatAppendStreamResponse,
): SlackSentMessage {
  const messageTs = response.ts ?? input.ts;

  return {
    channelId: response.channel ?? input.channel,
    messageTs,
    threadTs: undefined,
    raw: response,
  };
}

function encodeStopStreamResponse(
  input: SlackStopStreamRequest,
  response: ChatStopStreamResponse,
): SlackSentMessage {
  const messageTs = response.ts ?? response.message?.ts ?? input.ts;

  return {
    channelId: response.channel ?? input.channel,
    messageTs,
    threadTs: response.message?.thread_ts ?? input.thread_ts,
    raw: response,
  };
}

function removeUndefined<TRecord extends Record<string, unknown>>(record: TRecord): TRecord {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  ) as TRecord;
}
