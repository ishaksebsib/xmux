import { resolve } from "node:path";

/**
 * Delivery mode for harnesses responses.
 * Fanout - all chat platforms (telegram, discord, etc) that are in the same harness session will receive the message.
 * Requester only - only the chat platform that sent the message will receive it.
 */
export type XmuxDeliveryMode = "requester_only" | "fanout";

export interface XmuxConfig {
  readonly userName: string;
  readonly defaultWorkingDirectory: string;
  readonly deliveryMode: XmuxDeliveryMode;
}

export function normalizeConfig(config: XmuxConfig): XmuxConfig {
  return Object.freeze({
    userName: config.userName,
    defaultWorkingDirectory: resolve(config.defaultWorkingDirectory),
    deliveryMode: config.deliveryMode,
  });
}

