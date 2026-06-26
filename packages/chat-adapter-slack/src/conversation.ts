import type { SlackConversationScope } from "./types";
import { nonEmpty } from "./utils";

export interface SlackConversationTarget {
  readonly channelId: string;
  readonly threadTs?: string;
}

const slackConversationSeparator = ":";

/**
 * Creates the chat-core conversation id used by the Slack adapter.
 *
 * In channel scope every Slack message stays bound to its channel. In thread
 * scope only true thread replies receive a synthetic id; top-level channel
 * messages intentionally remain channel-scoped.
 */
export function createSlackConversationId(args: {
  readonly conversationScope: SlackConversationScope;
  readonly channelId: string;
  readonly threadTs?: string;
  readonly messageTs?: string;
}): string {
  const channelId = args.channelId.trim();
  const threadTs = resolveSlackThreadConversationTs({
    threadTs: args.threadTs,
    messageTs: args.messageTs,
  });

  return args.conversationScope === "thread" && threadTs !== undefined
    ? encodeSlackThreadConversationId({ channelId, threadTs })
    : channelId;
}

/** Parses a chat-core Slack conversation id into Slack Web API coordinates. */
export function parseSlackConversationId(conversationId: string): SlackConversationTarget {
  const trimmed = conversationId.trim();
  const separatorIndex = trimmed.indexOf(slackConversationSeparator);
  if (separatorIndex <= 0 || separatorIndex >= trimmed.length - 1) {
    return { channelId: trimmed };
  }

  const channelId = trimmed.slice(0, separatorIndex).trim();
  const threadTs = trimmed.slice(separatorIndex + 1).trim();

  return channelId.length === 0 || threadTs.length === 0
    ? { channelId: trimmed }
    : { channelId, threadTs };
}

export function encodeSlackThreadConversationId(args: {
  readonly channelId: string;
  readonly threadTs: string;
}): string {
  return `${args.channelId}${slackConversationSeparator}${args.threadTs}`;
}

/**
 * Returns a Slack thread timestamp only when the source is actually inside a
 * thread. Slack top-level messages may omit thread_ts or set it equal to ts;
 * both cases should remain channel-scoped.
 */
export function resolveSlackThreadConversationTs(args: {
  readonly threadTs?: string;
  readonly messageTs?: string;
}): string | undefined {
  const threadTs = nonEmpty(args.threadTs);
  if (threadTs === undefined) return undefined;

  const messageTs = nonEmpty(args.messageTs);
  return messageTs !== undefined && threadTs === messageTs ? undefined : threadTs;
}
