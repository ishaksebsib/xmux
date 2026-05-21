import { resolve } from "node:path";

/**
 * Delivery mode for harnesses responses.
 * Fanout - all chat platforms (telegram, discord, etc) that are in the same harness session will receive the message.
 * Requester only - only the chat platform that sent the message will receive it.
 */
export type DeliveryMode = "requester_only" | "fanout";

export interface WorkspaceConfig {
  readonly showHiddenFiles?: boolean;
  readonly maxListEntries?: number;
}

export interface NormalizedWorkspaceConfig {
  readonly showHiddenFiles: boolean;
  readonly maxListEntries: number;
}

export interface Config {
  readonly userName: string;
  readonly defaultWorkingDirectory: string;
  readonly deliveryMode: DeliveryMode;
  readonly workspace?: WorkspaceConfig;
}

export interface NormalizedConfig {
  readonly userName: string;
  readonly defaultWorkingDirectory: string;
  readonly deliveryMode: DeliveryMode;
  readonly workspace: NormalizedWorkspaceConfig;
}

const DEFAULT_MAX_LIST_ENTRIES = 100;

export function normalizeConfig(config: Config): NormalizedConfig {
  return Object.freeze({
    userName: config.userName,
    defaultWorkingDirectory: resolve(config.defaultWorkingDirectory),
    deliveryMode: config.deliveryMode,
    workspace: Object.freeze({
      showHiddenFiles: config.workspace?.showHiddenFiles ?? false,
      maxListEntries: normalizeMaxListEntries(config.workspace?.maxListEntries),
    }),
  });
}

function normalizeMaxListEntries(value: number | undefined): number {
  if (value === undefined || !Number.isInteger(value) || value < 1) {
    return DEFAULT_MAX_LIST_ENTRIES;
  }

  return value;
}
