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

export interface ResumeConfig {
  readonly maxSessionsPerHarness?: number;
}

export interface NormalizedResumeConfig {
  readonly maxSessionsPerHarness: number;
}

export interface ModelConfig {
  readonly maxModelsPerProvider?: number;
}

export interface NormalizedModelConfig {
  readonly maxModelsPerProvider: number;
}

export interface Config {
  readonly userName: string;
  readonly defaultWorkingDirectory: string;
  readonly deliveryMode: DeliveryMode;
  readonly workspace?: WorkspaceConfig;
  readonly resume?: ResumeConfig;
  readonly model?: ModelConfig;
}

export interface NormalizedConfig {
  readonly userName: string;
  readonly defaultWorkingDirectory: string;
  readonly deliveryMode: DeliveryMode;
  readonly workspace: NormalizedWorkspaceConfig;
  readonly resume: NormalizedResumeConfig;
  readonly model: NormalizedModelConfig;
}

const DEFAULT_MAX_LIST_ENTRIES = 100;
const DEFAULT_MAX_RESUME_SESSIONS_PER_HARNESS = 5;
const DEFAULT_MAX_MODELS_PER_PROVIDER = 10;

export function normalizeConfig(config: Config): NormalizedConfig {
  return Object.freeze({
    userName: config.userName,
    defaultWorkingDirectory: resolve(config.defaultWorkingDirectory),
    deliveryMode: config.deliveryMode,
    workspace: Object.freeze({
      showHiddenFiles: config.workspace?.showHiddenFiles ?? false,
      maxListEntries: normalizeMaxListEntries(config.workspace?.maxListEntries),
    }),
    resume: Object.freeze({
      maxSessionsPerHarness: normalizeMaxResumeSessionsPerHarness(
        config.resume?.maxSessionsPerHarness,
      ),
    }),
    model: Object.freeze({
      maxModelsPerProvider: normalizeMaxModelsPerProvider(config.model?.maxModelsPerProvider),
    }),
  });
}

function normalizeMaxListEntries(value: number | undefined): number {
  if (value === undefined || !Number.isInteger(value) || value < 1) {
    return DEFAULT_MAX_LIST_ENTRIES;
  }

  return value;
}

function normalizeMaxResumeSessionsPerHarness(value: number | undefined): number {
  if (value === undefined || !Number.isInteger(value) || value < 1) {
    return DEFAULT_MAX_RESUME_SESSIONS_PER_HARNESS;
  }

  return value;
}

function normalizeMaxModelsPerProvider(value: number | undefined): number {
  if (value === undefined || !Number.isInteger(value) || value < 1) {
    return DEFAULT_MAX_MODELS_PER_PROVIDER;
  }

  return value;
}
