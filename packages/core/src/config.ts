import { resolve } from "node:path";
import type { ChatAttachmentKind } from "@xmux/chat-core";

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

export interface PromptResponseConfig {
  readonly showToolOutput?: boolean;
  readonly maxToolTextOutputChars?: number;
  readonly maxToolJsonOutputChars?: number;
  readonly maxReasoningChars?: number;
  readonly maxToolInputStringChars?: number;
  readonly maxToolInputObjectEntries?: number;
  readonly maxStreamDeltaChars?: number;
}

export interface NormalizedPromptResponseConfig {
  readonly showToolOutput: boolean;
  readonly maxToolTextOutputChars: number;
  readonly maxToolJsonOutputChars: number;
  readonly maxReasoningChars: number;
  readonly maxToolInputStringChars: number;
  readonly maxToolInputObjectEntries: number;
  readonly maxStreamDeltaChars?: number;
}

export interface PromptAttachmentsConfig {
  readonly enabled?: boolean;
  readonly maxBytes?: number;
  readonly kinds?: readonly ChatAttachmentKind[];
}

export interface NormalizedPromptAttachmentsConfig {
  readonly enabled: boolean;
  readonly maxBytes: number;
  readonly kinds: readonly ChatAttachmentKind[];
}

export interface PromptConfig {
  readonly response?: PromptResponseConfig;
  readonly attachments?: PromptAttachmentsConfig;
}

export interface NormalizedPromptConfig {
  readonly response: NormalizedPromptResponseConfig;
  readonly attachments: NormalizedPromptAttachmentsConfig;
}

export interface Config {
  readonly userName: string;
  readonly defaultWorkingDirectory: string;
  readonly deliveryMode: DeliveryMode;
  readonly workspace?: WorkspaceConfig;
  readonly resume?: ResumeConfig;
  readonly model?: ModelConfig;
  readonly prompt?: PromptConfig;
}

export interface NormalizedConfig {
  readonly userName: string;
  readonly defaultWorkingDirectory: string;
  readonly deliveryMode: DeliveryMode;
  readonly workspace: NormalizedWorkspaceConfig;
  readonly resume: NormalizedResumeConfig;
  readonly model: NormalizedModelConfig;
  readonly prompt: NormalizedPromptConfig;
}

const DEFAULT_MAX_LIST_ENTRIES = 100;
const DEFAULT_MAX_RESUME_SESSIONS_PER_HARNESS = 5;
const DEFAULT_MAX_MODELS_PER_PROVIDER = 10;
const DEFAULT_PROMPT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const PROMPT_ATTACHMENT_KINDS = Object.freeze([
  "image",
  "audio",
  "video",
  "document",
  "archive",
  "other",
] as const satisfies readonly ChatAttachmentKind[]);
export const DEFAULT_PROMPT_ATTACHMENTS_CONFIG: Readonly<NormalizedPromptAttachmentsConfig> =
  Object.freeze({
    enabled: true,
    maxBytes: DEFAULT_PROMPT_ATTACHMENT_MAX_BYTES,
    kinds: PROMPT_ATTACHMENT_KINDS,
  });
export const DEFAULT_PROMPT_RESPONSE_CONFIG: Readonly<NormalizedPromptResponseConfig> =
  Object.freeze({
    showToolOutput: true,
    maxToolTextOutputChars: 280,
    maxToolJsonOutputChars: 400,
    maxReasoningChars: 320,
    maxToolInputStringChars: 50,
    maxToolInputObjectEntries: 2,
  });

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
    prompt: Object.freeze({
      response: normalizePromptResponseConfig(config.prompt?.response),
      attachments: normalizePromptAttachmentsConfig(config.prompt?.attachments),
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

function normalizePromptAttachmentsConfig(
  config: PromptAttachmentsConfig | undefined,
): NormalizedPromptAttachmentsConfig {
  return Object.freeze({
    enabled: config?.enabled ?? DEFAULT_PROMPT_ATTACHMENTS_CONFIG.enabled,
    maxBytes: normalizePositiveInteger(
      config?.maxBytes,
      DEFAULT_PROMPT_ATTACHMENTS_CONFIG.maxBytes,
    ),
    kinds: normalizePromptAttachmentKinds(config?.kinds),
  });
}

function normalizePromptAttachmentKinds(
  kinds: readonly ChatAttachmentKind[] | undefined,
): readonly ChatAttachmentKind[] {
  if (kinds === undefined) return DEFAULT_PROMPT_ATTACHMENTS_CONFIG.kinds;

  const normalized = kinds.filter(
    (kind, index) => PROMPT_ATTACHMENT_KINDS.includes(kind) && kinds.indexOf(kind) === index,
  );

  return normalized.length === 0
    ? DEFAULT_PROMPT_ATTACHMENTS_CONFIG.kinds
    : Object.freeze(normalized);
}

function normalizePromptResponseConfig(
  config: PromptResponseConfig | undefined,
): NormalizedPromptResponseConfig {
  const maxStreamDeltaChars = normalizeOptionalPositiveInteger(config?.maxStreamDeltaChars);

  return Object.freeze({
    showToolOutput: config?.showToolOutput ?? DEFAULT_PROMPT_RESPONSE_CONFIG.showToolOutput,
    maxToolTextOutputChars: normalizePositiveInteger(
      config?.maxToolTextOutputChars,
      DEFAULT_PROMPT_RESPONSE_CONFIG.maxToolTextOutputChars,
    ),
    maxToolJsonOutputChars: normalizePositiveInteger(
      config?.maxToolJsonOutputChars,
      DEFAULT_PROMPT_RESPONSE_CONFIG.maxToolJsonOutputChars,
    ),
    maxReasoningChars: normalizePositiveInteger(
      config?.maxReasoningChars,
      DEFAULT_PROMPT_RESPONSE_CONFIG.maxReasoningChars,
    ),
    maxToolInputStringChars: normalizePositiveInteger(
      config?.maxToolInputStringChars,
      DEFAULT_PROMPT_RESPONSE_CONFIG.maxToolInputStringChars,
    ),
    maxToolInputObjectEntries: normalizePositiveInteger(
      config?.maxToolInputObjectEntries,
      DEFAULT_PROMPT_RESPONSE_CONFIG.maxToolInputObjectEntries,
    ),
    ...(maxStreamDeltaChars === undefined ? {} : { maxStreamDeltaChars }),
  });
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isInteger(value) || value < 1 ? fallback : value;
}

function normalizeOptionalPositiveInteger(value: number | undefined): number | undefined {
  return value === undefined || !Number.isInteger(value) || value < 1 ? undefined : value;
}
