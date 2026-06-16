import {
  App,
  type SlackActionMiddlewareArgs,
  type SlackCommandMiddlewareArgs,
  type SlackEventMiddlewareArgs,
} from "@slack/bolt";
import type {
  ChatPostEphemeralArguments,
  ChatPostEphemeralResponse,
  ChatPostMessageArguments,
  ChatPostMessageResponse,
  ChatUpdateArguments,
  ChatUpdateResponse,
  FilesInfoArguments,
  FilesInfoResponse,
} from "@slack/web-api";
import type { SlackAdapterConfigMode, SlackBotToken } from "./config";
import type { SlackBlock, SlackClientOptions, SlackMessageMetadata } from "./types";

type SlackBoltMessageArgs = SlackEventMiddlewareArgs<"message">;
type SlackBoltReactionAddedArgs = SlackEventMiddlewareArgs<"reaction_added">;
type SlackBoltReactionRemovedArgs = SlackEventMiddlewareArgs<"reaction_removed">;

export type SlackMessageHandler = (event: SlackMessageEvent) => void | Promise<void>;
export type SlackCommandHandler = (event: SlackCommandEvent) => void | Promise<void>;
export type SlackActionHandler = (event: SlackActionEvent) => void | Promise<void>;
export type SlackReactionHandler = (event: SlackReactionEvent) => void | Promise<void>;
export type SlackErrorHandler = (error: unknown) => void | Promise<void>;

export interface SlackMessageEvent {
  readonly event: SlackBoltMessageArgs["event"];
  readonly body: SlackBoltMessageArgs["body"];
  readonly raw: SlackBoltMessageArgs;
}

export interface SlackCommandEvent {
  readonly payload: SlackCommandMiddlewareArgs["command"];
  readonly ack: () => Promise<void>;
  readonly respond: SlackCommandMiddlewareArgs["respond"];
  readonly raw: SlackCommandMiddlewareArgs;
}

export interface SlackActionEvent {
  readonly payload: SlackActionMiddlewareArgs["payload"];
  readonly action: SlackActionMiddlewareArgs["action"];
  readonly body: SlackActionMiddlewareArgs["body"];
  readonly ack: () => Promise<void>;
  readonly respond: SlackActionMiddlewareArgs["respond"];
  readonly raw: SlackActionMiddlewareArgs;
}

export interface SlackReactionEvent {
  readonly event: SlackBoltReactionAddedArgs["event"] | SlackBoltReactionRemovedArgs["event"];
  readonly body: SlackBoltReactionAddedArgs["body"] | SlackBoltReactionRemovedArgs["body"];
  readonly raw: SlackBoltReactionAddedArgs | SlackBoltReactionRemovedArgs;
}

export interface SlackPostMessageRequest {
  readonly channel: string;
  readonly text: string;
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
  readonly text: string;
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
  readonly text: string;
  readonly mrkdwn?: boolean;
  readonly blocks?: readonly SlackBlock[];
  readonly thread_ts?: string;
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
  onCommand(handler: SlackCommandHandler): void;
  onAction(handler: SlackActionHandler): void;
  onReactionAdded(handler: SlackReactionHandler): void;
  onReactionRemoved(handler: SlackReactionHandler): void;
  onError(handler: SlackErrorHandler): void;
  postMessage(input: SlackPostMessageRequest): Promise<SlackSentMessage>;
  updateMessage(input: SlackUpdateMessageRequest): Promise<SlackSentMessage>;
  postEphemeral(input: SlackPostEphemeralRequest): Promise<SlackSentMessage>;
  openFile(input: SlackOpenFileRequest): Promise<FilesInfoResponse>;
  downloadFile(input: SlackDownloadFileRequest): Promise<Response>;
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
        await handler({ event: event.event, body: event.body, raw: event });
      });
    },
    onCommand: (handler) => {
      app.command(/.*/, async (event) => {
        await handler({
          payload: event.command,
          ack: () => event.ack(),
          respond: event.respond,
          raw: event,
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
        });
      });
    },
    onReactionAdded: (handler) => {
      app.event("reaction_added", async (event) => {
        await handler({ event: event.event, body: event.body, raw: event });
      });
    },
    onReactionRemoved: (handler) => {
      app.event("reaction_removed", async (event) => {
        await handler({ event: event.event, body: event.body, raw: event });
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
    openFile: (input) => app.client.files.info(toFilesInfoArguments(input)),
    downloadFile: (input) =>
      fetch(input.url, {
        headers: { Authorization: `Bearer ${args.botToken}` },
        signal: input.signal,
      }),
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
    mrkdwn: input.mrkdwn,
    thread_ts: input.thread_ts,
  });

  return (
    input.blocks === undefined ? base : { ...base, blocks: mutableBlocks(input.blocks) }
  ) as ChatPostEphemeralArguments;
}

function toFilesInfoArguments(input: SlackOpenFileRequest): FilesInfoArguments {
  return { file: input.fileId };
}

function mutableBlocks(blocks: readonly SlackBlock[]): SlackBlock[] {
  return [...blocks];
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

function removeUndefined<TRecord extends Record<string, unknown>>(record: TRecord): TRecord {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  ) as TRecord;
}
