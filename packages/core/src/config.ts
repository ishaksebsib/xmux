import { resolve } from "node:path";

/**
 * Delivery mode for harnesses responses.
 * Fanout - all chat platforms (telegram, discord, etc) that are in the same harness session will receive the message.
 * Requester only - only the chat platform that sent the message will receive it.
 */
export type DeliveryMode = "requester_only" | "fanout";

export interface Config {
  readonly userName: string;
  readonly defaultWorkingDirectory: string;
  readonly deliveryMode: DeliveryMode;
}

export function normalizeConfig(config: Config): Config {
  return Object.freeze({
    userName: config.userName,
    defaultWorkingDirectory: resolve(config.defaultWorkingDirectory),
    deliveryMode: config.deliveryMode,
  });
}
