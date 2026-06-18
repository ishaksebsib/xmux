import type { ChatLogger } from "@xmux/chat-core";
import type { AppOptions } from "@slack/bolt";

/** Selects how Slack events are delivered. Socket Mode is the supported v1 runtime. */
export type SlackAdapterMode =
  | {
      readonly type: "socket";
      readonly appToken: string;
    }
  | {
      readonly type: "http";
      readonly signingSecret: string;
    };

/** Controls how manually configured Slack slash commands map to chat-core commands. */
export type SlackCommandMode =
  | { readonly type: "direct" }
  | { readonly type: "root"; readonly command: string };

/** Minimal JSON-like Slack Block Kit block shape accepted as native adapter options. */
export type SlackBlock = Readonly<Record<string, unknown>> & {
  readonly type: string;
};

/** Minimal Slack message metadata shape forwarded to chat.postMessage/chat.update. */
export interface SlackMessageMetadata {
  readonly event_type: string;
  readonly event_payload: Readonly<Record<string, unknown>>;
}

/** Per-call native Slack stream targeting overrides. */
export interface SlackNativeStreamOptions {
  /** Parent Slack message timestamp override for native streams that cannot infer a source message. */
  readonly threadTs?: string;
  /** Optional receiving user override for arbitrary channel streams. Reply streams infer this. */
  readonly recipientUserId?: string;
  /** Optional receiving team override for arbitrary channel streams. Reply streams infer this. */
  readonly recipientTeamId?: string;
  /** Slack task display mode for richer streaming chunks. Text streaming uses the default when omitted. */
  readonly taskDisplayMode?: string;
  /** Per-call native stream buffer size override. */
  readonly bufferSize?: number;
  /** Per-message native stream text limit override. Must not exceed Slack's markdown_text limit. */
  readonly maxSegmentChars?: number;
}

/** Per-call native Slack options. */
export type SlackAdapterOptions = {
  readonly blocks?: readonly SlackBlock[];
  readonly metadata?: SlackMessageMetadata;
  readonly unfurl_links?: boolean;
  readonly unfurl_media?: boolean;
  readonly replyBroadcast?: boolean;
  readonly ephemeral?: boolean;
  readonly stream?: SlackNativeStreamOptions;
};

/** Native Slack metadata kept opaque by chat-core. */
export interface SlackActionEnvelope {
  readonly actionId: string;
  readonly value: string;
  readonly payload?: unknown;
}

/** Optional process-local or persistent store for Slack button action envelopes. */
export interface SlackActionStore {
  get(key: string): SlackActionEnvelope | undefined | Promise<SlackActionEnvelope | undefined>;
  set(
    key: string,
    envelope: SlackActionEnvelope,
    options?: { readonly ttlMs?: number },
  ): void | Promise<void>;
  delete?(key: string): void | Promise<void>;
}

export type SlackAdapterData = {
  readonly slackTeamId?: string;
  readonly slackEnterpriseId?: string;
  readonly slackChannelId: string;
  readonly slackMessageTs?: string;
  readonly slackThreadTs?: string;
  readonly slackUserId?: string;
  readonly slackBotId?: string;
  readonly slackFileId?: string;
  readonly raw: unknown;
};

/** Native streaming defaults for Slack message streams. */
export interface SlackStreamOptions {
  /** Number of markdown_text characters buffered before a native append call. */
  readonly bufferSize?: number;
  /** Maximum streamed markdown_text characters per Slack stream message segment. */
  readonly maxSegmentChars?: number;
  /** Optional text to stream when the upstream stream completes without content. */
  readonly emptyText?: string;
}

/** Options forwarded to Bolt's App constructor after Slack credentials are applied. */
export type SlackClientOptions = Omit<
  AppOptions,
  "token" | "appToken" | "signingSecret" | "socketMode"
>;

/** Configuration for creating a Slack chat adapter. */
export interface CreateSlackAdapterOptions<TChatId extends string = "slack"> {
  readonly id?: TChatId;
  readonly botToken?: string;
  readonly mode?: SlackAdapterMode;
  readonly commandMode?: SlackCommandMode;
  readonly actionStore?: SlackActionStore;
  readonly stream?: SlackStreamOptions;
  readonly clientOptions?: SlackClientOptions;
  readonly logger?: ChatLogger;
}
