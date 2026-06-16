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

/** Per-call native Slack options. */
export type SlackAdapterOptions = {
  readonly blocks?: readonly SlackBlock[];
  readonly metadata?: SlackMessageMetadata;
  readonly unfurl_links?: boolean;
  readonly unfurl_media?: boolean;
  readonly replyBroadcast?: boolean;
  readonly ephemeral?: boolean;
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

/** Edit-based streaming defaults for Slack message streams. */
export interface SlackStreamOptions {
  readonly placeholderText?: string;
  readonly editIntervalMs?: number;
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
