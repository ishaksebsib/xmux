import type { ChatLogger } from "@xmux/chat-core";
import type { AppOptions } from "@slack/bolt";

/**
 * Selects how Slack events are delivered.
 * Default: Socket Mode (`type: "socket"`); `appToken` is still required.
 */
export type SlackAdapterMode =
  | {
      readonly type: "socket";
      readonly appToken: string;
    }
  | {
      readonly type: "http";
      readonly signingSecret: string;
    };

/**
 * Controls how manually configured Slack slash commands map to chat-core commands.
 * Default: direct mode (`{ type: "direct" }`).
 */
export type SlackCommandMode =
  | { readonly type: "direct" }
  | { readonly type: "root"; readonly command: string };

/** Controls whether Slack app mentions can invoke chat-core commands. */
export interface SlackMentionCommandOptions {
  /** Default: false. When true, `@bot command [options]` app mentions emit command events. */
  readonly enabled?: boolean;
}

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
  /** Slack task display mode for richer streaming chunks. Default: omitted (Slack default). */
  readonly taskDisplayMode?: string;
  /** Per-call native stream buffer size override. Default: adapter stream bufferSize (256). */
  readonly bufferSize?: number;
  /** Per-message native stream text limit override. Default: adapter stream maxSegmentChars (12,000). */
  readonly maxSegmentChars?: number;
}

/** Per-call native Slack options. */
export type SlackAdapterOptions = {
  /** Default: omitted; Slack renders generated text/markdown. */
  readonly blocks?: readonly SlackBlock[];
  /** Default: omitted. */
  readonly metadata?: SlackMessageMetadata;
  /** Default: omitted (Slack default). */
  readonly unfurl_links?: boolean;
  /** Default: omitted (Slack default). */
  readonly unfurl_media?: boolean;
  /** Default: omitted/false; only applies to threaded replies. */
  readonly replyBroadcast?: boolean;
  /** Default: false; only action replies are sent ephemerally when true. */
  readonly ephemeral?: boolean;
  /** Default: adapter stream defaults with inferred reply targets when available. */
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
  /** Number of markdown_text characters buffered before a native append call. Default: 256. */
  readonly bufferSize?: number;
  /** Maximum streamed markdown_text characters per Slack stream message segment. Default: 12,000. */
  readonly maxSegmentChars?: number;
  /** Optional text to stream when the upstream stream completes without content. Default: "". */
  readonly emptyText?: string;
}

/** Options forwarded to Bolt's App constructor after Slack credentials are applied. */
export type SlackClientOptions = Omit<
  AppOptions,
  "token" | "appToken" | "signingSecret" | "socketMode"
>;

/** Configuration for creating a Slack chat adapter. */
export interface CreateSlackAdapterOptions<TChatId extends string = "slack"> {
  /** Chat adapter id. Default: "slack". */
  readonly id?: TChatId;
  /** Bot User OAuth token (`xoxb-...`). No default. */
  readonly botToken?: string;
  /** Slack delivery mode. Default: Socket Mode; provide `mode.appToken`. */
  readonly mode?: SlackAdapterMode;
  /** Slash-command routing mode. Default: `{ type: "direct" }`. */
  readonly commandMode?: SlackCommandMode;
  /** App-mention command routing. Default: disabled. */
  readonly mentionCommands?: SlackMentionCommandOptions;
  /** Store for oversized button payloads. Default: none; oversized payloads error. */
  readonly actionStore?: SlackActionStore;
  /** Native stream defaults. Default: bufferSize 256, maxSegmentChars 12,000, emptyText "". */
  readonly stream?: SlackStreamOptions;
  /** Extra Bolt App options. Default: none. */
  readonly clientOptions?: SlackClientOptions;
  /** Adapter logger. Default: chat-core context logger. */
  readonly logger?: ChatLogger;
}
