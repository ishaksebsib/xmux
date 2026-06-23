import { resolve } from "node:path";
import type { ChatAttachmentKind } from "@xmux/chat-core";
import { parseSpeechToTextClientConfig, type SpeechToTextClientConfig } from "@xmux/stt";
import { Result, type Result as ResultType } from "better-result";
import { XmuxConfigurationError } from "./errors";

/**
 * Delivery mode for harnesses responses.
 * Fanout - all chat platforms (telegram, discord, etc) that are in the same harness session will receive the message.
 * Requester only - only the chat platform that sent the message will receive it.
 */
export type DeliveryMode = "requester_only" | "fanout";

declare const absolutePathBrand: unique symbol;

/** Absolute path produced by the xmux config parser. */
export type AbsolutePath = string & { readonly [absolutePathBrand]: true };

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
  readonly showReasoning?: boolean;
  readonly maxToolTextOutputChars?: number;
  readonly maxToolJsonOutputChars?: number;
  readonly maxReasoningChars?: number;
  readonly maxToolInputStringChars?: number;
  readonly maxToolInputObjectEntries?: number;
  readonly maxStreamDeltaChars?: number;
}

export interface NormalizedPromptResponseConfig {
  readonly showToolOutput: boolean;
  readonly showReasoning: boolean;
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

export interface SttConfig {
  readonly enabled?: boolean;
  readonly provider?: "openai-compatible";
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly endpointPath?: string;
  readonly model?: string;
  readonly language?: string;
  readonly maxBytes?: number;
  readonly timeoutMs?: number;
}

export type NormalizedSttConfig =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly clientConfig: SpeechToTextClientConfig;
      readonly language?: string;
      readonly maxBytes: number;
    };

export interface NormalizedPromptConfig {
  readonly response: NormalizedPromptResponseConfig;
  readonly attachments: NormalizedPromptAttachmentsConfig;
}

export interface Config {
  readonly defaultWorkingDirectory: string;
  readonly deliveryMode: DeliveryMode;
  readonly workspace?: WorkspaceConfig;
  readonly resume?: ResumeConfig;
  readonly model?: ModelConfig;
  readonly prompt?: PromptConfig;
  readonly stt?: SttConfig;
}

export interface NormalizedConfig {
  readonly defaultWorkingDirectory: AbsolutePath;
  readonly deliveryMode: DeliveryMode;
  readonly workspace: NormalizedWorkspaceConfig;
  readonly resume: NormalizedResumeConfig;
  readonly model: NormalizedModelConfig;
  readonly prompt: NormalizedPromptConfig;
  readonly stt: NormalizedSttConfig;
}

const DEFAULT_MAX_LIST_ENTRIES = 100;
const DEFAULT_MAX_RESUME_SESSIONS_PER_HARNESS = 5;
const DEFAULT_MAX_MODELS_PER_PROVIDER = 10;
const DEFAULT_PROMPT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_STT_MAX_BYTES = 25 * 1024 * 1024;
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
    showReasoning: true,
    maxToolTextOutputChars: 280,
    maxToolJsonOutputChars: 400,
    maxReasoningChars: 320,
    maxToolInputStringChars: 50,
    maxToolInputObjectEntries: 2,
  });

function configError(path: string, reason: string): XmuxConfigurationError {
  return new XmuxConfigurationError({ path, reason });
}

function parseNonEmptyString(
  input: unknown,
  path: string,
): ResultType<string, XmuxConfigurationError> {
  return typeof input === "string" && input.trim().length > 0
    ? Result.ok(input)
    : Result.err(configError(path, "must be a non-empty string"));
}

function parseDefaultWorkingDirectory(
  input: unknown,
): ResultType<AbsolutePath, XmuxConfigurationError> {
  return Result.map(
    parseNonEmptyString(input, "defaultWorkingDirectory"),
    (directory) => resolve(directory) as AbsolutePath,
  );
}

function parseDeliveryMode(input: unknown): ResultType<DeliveryMode, XmuxConfigurationError> {
  return input === "requester_only" || input === "fanout"
    ? Result.ok(input)
    : Result.err(configError("deliveryMode", "must be requester_only or fanout"));
}

function parseBoolean(
  input: unknown,
  path: string,
  fallback: boolean,
): ResultType<boolean, XmuxConfigurationError> {
  if (input === undefined) return Result.ok(fallback);
  return typeof input === "boolean"
    ? Result.ok(input)
    : Result.err(configError(path, "must be a boolean"));
}

function parsePositiveInteger(
  input: unknown,
  path: string,
  fallback: number,
): ResultType<number, XmuxConfigurationError> {
  if (input === undefined) return Result.ok(fallback);
  return typeof input === "number" && Number.isInteger(input) && input > 0
    ? Result.ok(input)
    : Result.err(configError(path, "must be a positive integer"));
}

function parseOptionalPositiveInteger(
  input: unknown,
  path: string,
): ResultType<number | undefined, XmuxConfigurationError> {
  if (input === undefined) return Result.ok(undefined);
  return typeof input === "number" && Number.isInteger(input) && input > 0
    ? Result.ok(input)
    : Result.err(configError(path, "must be a positive integer when provided"));
}

function parseOptionalObject<T>(
  input: T | undefined,
  path: string,
): ResultType<T | undefined, XmuxConfigurationError> {
  if (input === undefined) return Result.ok(undefined);
  return typeof input === "object" && input !== null
    ? Result.ok(input)
    : Result.err(configError(path, "must be an object"));
}

function parseWorkspaceConfig(
  config: WorkspaceConfig | undefined,
): ResultType<NormalizedWorkspaceConfig, XmuxConfigurationError> {
  return Result.gen(function* () {
    const parsed = yield* parseOptionalObject(config, "workspace");
    const showHiddenFiles = yield* parseBoolean(
      parsed?.showHiddenFiles,
      "workspace.showHiddenFiles",
      false,
    );
    const maxListEntries = yield* parsePositiveInteger(
      parsed?.maxListEntries,
      "workspace.maxListEntries",
      DEFAULT_MAX_LIST_ENTRIES,
    );

    return Result.ok(Object.freeze({ showHiddenFiles, maxListEntries }));
  });
}

function parseResumeConfig(
  config: ResumeConfig | undefined,
): ResultType<NormalizedResumeConfig, XmuxConfigurationError> {
  return Result.gen(function* () {
    const parsed = yield* parseOptionalObject(config, "resume");
    const maxSessionsPerHarness = yield* parsePositiveInteger(
      parsed?.maxSessionsPerHarness,
      "resume.maxSessionsPerHarness",
      DEFAULT_MAX_RESUME_SESSIONS_PER_HARNESS,
    );
    return Result.ok(Object.freeze({ maxSessionsPerHarness }));
  });
}

function parseModelConfig(
  config: ModelConfig | undefined,
): ResultType<NormalizedModelConfig, XmuxConfigurationError> {
  return Result.gen(function* () {
    const parsed = yield* parseOptionalObject(config, "model");
    const maxModelsPerProvider = yield* parsePositiveInteger(
      parsed?.maxModelsPerProvider,
      "model.maxModelsPerProvider",
      DEFAULT_MAX_MODELS_PER_PROVIDER,
    );
    return Result.ok(Object.freeze({ maxModelsPerProvider }));
  });
}

function isChatAttachmentKind(input: unknown): input is ChatAttachmentKind {
  return typeof input === "string" && PROMPT_ATTACHMENT_KINDS.includes(input as ChatAttachmentKind);
}

function parsePromptAttachmentKinds(
  kinds: readonly ChatAttachmentKind[] | undefined,
): ResultType<readonly ChatAttachmentKind[], XmuxConfigurationError> {
  if (kinds === undefined) return Result.ok(DEFAULT_PROMPT_ATTACHMENTS_CONFIG.kinds);
  if (!Array.isArray(kinds)) {
    return Result.err(configError("prompt.attachments.kinds", "must be an array"));
  }

  const parsed: ChatAttachmentKind[] = [];
  for (const kind of kinds) {
    if (!isChatAttachmentKind(kind)) {
      return Result.err(
        configError("prompt.attachments.kinds", `unsupported attachment kind: ${String(kind)}`),
      );
    }
    if (!parsed.includes(kind)) parsed.push(kind);
  }

  return Result.ok(Object.freeze(parsed));
}

function parsePromptAttachmentsConfig(
  config: PromptAttachmentsConfig | undefined,
): ResultType<NormalizedPromptAttachmentsConfig, XmuxConfigurationError> {
  return Result.gen(function* () {
    const parsed = yield* parseOptionalObject(config, "prompt.attachments");
    const enabled = yield* parseBoolean(
      parsed?.enabled,
      "prompt.attachments.enabled",
      DEFAULT_PROMPT_ATTACHMENTS_CONFIG.enabled,
    );
    const maxBytes = yield* parsePositiveInteger(
      parsed?.maxBytes,
      "prompt.attachments.maxBytes",
      DEFAULT_PROMPT_ATTACHMENTS_CONFIG.maxBytes,
    );
    const kinds = yield* parsePromptAttachmentKinds(parsed?.kinds);

    return Result.ok(Object.freeze({ enabled, maxBytes, kinds }));
  });
}

function parsePromptResponseConfig(
  config: PromptResponseConfig | undefined,
): ResultType<NormalizedPromptResponseConfig, XmuxConfigurationError> {
  return Result.gen(function* () {
    const parsed = yield* parseOptionalObject(config, "prompt.response");
    const showToolOutput = yield* parseBoolean(
      parsed?.showToolOutput,
      "prompt.response.showToolOutput",
      DEFAULT_PROMPT_RESPONSE_CONFIG.showToolOutput,
    );
    const showReasoning = yield* parseBoolean(
      parsed?.showReasoning,
      "prompt.response.showReasoning",
      DEFAULT_PROMPT_RESPONSE_CONFIG.showReasoning,
    );
    const maxToolTextOutputChars = yield* parsePositiveInteger(
      parsed?.maxToolTextOutputChars,
      "prompt.response.maxToolTextOutputChars",
      DEFAULT_PROMPT_RESPONSE_CONFIG.maxToolTextOutputChars,
    );
    const maxToolJsonOutputChars = yield* parsePositiveInteger(
      parsed?.maxToolJsonOutputChars,
      "prompt.response.maxToolJsonOutputChars",
      DEFAULT_PROMPT_RESPONSE_CONFIG.maxToolJsonOutputChars,
    );
    const maxReasoningChars = yield* parsePositiveInteger(
      parsed?.maxReasoningChars,
      "prompt.response.maxReasoningChars",
      DEFAULT_PROMPT_RESPONSE_CONFIG.maxReasoningChars,
    );
    const maxToolInputStringChars = yield* parsePositiveInteger(
      parsed?.maxToolInputStringChars,
      "prompt.response.maxToolInputStringChars",
      DEFAULT_PROMPT_RESPONSE_CONFIG.maxToolInputStringChars,
    );
    const maxToolInputObjectEntries = yield* parsePositiveInteger(
      parsed?.maxToolInputObjectEntries,
      "prompt.response.maxToolInputObjectEntries",
      DEFAULT_PROMPT_RESPONSE_CONFIG.maxToolInputObjectEntries,
    );
    const maxStreamDeltaChars = yield* parseOptionalPositiveInteger(
      parsed?.maxStreamDeltaChars,
      "prompt.response.maxStreamDeltaChars",
    );

    return Result.ok(
      Object.freeze({
        showToolOutput,
        showReasoning,
        maxToolTextOutputChars,
        maxToolJsonOutputChars,
        maxReasoningChars,
        maxToolInputStringChars,
        maxToolInputObjectEntries,
        ...(maxStreamDeltaChars === undefined ? {} : { maxStreamDeltaChars }),
      }),
    );
  });
}

function parsePromptConfig(
  config: PromptConfig | undefined,
): ResultType<NormalizedPromptConfig, XmuxConfigurationError> {
  return Result.gen(function* () {
    const parsed = yield* parseOptionalObject(config, "prompt");
    const response = yield* parsePromptResponseConfig(parsed?.response);
    const attachments = yield* parsePromptAttachmentsConfig(parsed?.attachments);
    return Result.ok(Object.freeze({ response, attachments }));
  });
}

function parseOptionalString(
  input: unknown,
  path: string,
): ResultType<string | undefined, XmuxConfigurationError> {
  if (input === undefined) return Result.ok(undefined);
  return typeof input === "string"
    ? Result.ok(input)
    : Result.err(configError(path, "must be a string when provided"));
}

function parseOptionalNonEmptyString(
  input: unknown,
  path: string,
): ResultType<string | undefined, XmuxConfigurationError> {
  if (input === undefined) return Result.ok(undefined);
  return parseNonEmptyString(input, path);
}

function parseSttProvider(input: unknown): ResultType<"openai-compatible", XmuxConfigurationError> {
  if (input === undefined || input === "openai-compatible") return Result.ok("openai-compatible");
  return Result.err(configError("stt.provider", "must be openai-compatible"));
}

function parseSttConfig(
  config: SttConfig | undefined,
): ResultType<NormalizedSttConfig, XmuxConfigurationError> {
  return Result.gen(function* () {
    const parsed = yield* parseOptionalObject(config, "stt");
    const enabled = yield* parseBoolean(parsed?.enabled, "stt.enabled", false);
    if (!enabled) return Result.ok(Object.freeze({ enabled: false } as const));

    const provider = yield* parseSttProvider(parsed?.provider);
    const apiKey = yield* parseOptionalString(parsed?.apiKey, "stt.apiKey");
    const baseUrl = yield* parseOptionalNonEmptyString(parsed?.baseUrl, "stt.baseUrl");
    const endpointPath = yield* parseOptionalNonEmptyString(
      parsed?.endpointPath,
      "stt.endpointPath",
    );
    const model = yield* parseNonEmptyString(parsed?.model, "stt.model");
    const language = yield* parseOptionalNonEmptyString(parsed?.language, "stt.language");
    const maxBytes = yield* parsePositiveInteger(
      parsed?.maxBytes,
      "stt.maxBytes",
      DEFAULT_STT_MAX_BYTES,
    );
    const timeoutMs = yield* parseOptionalPositiveInteger(parsed?.timeoutMs, "stt.timeoutMs");

    const clientConfig: SpeechToTextClientConfig = {
      provider,
      model,
      ...(apiKey === undefined ? {} : { apiKey }),
      ...(baseUrl === undefined ? {} : { baseUrl }),
      ...(endpointPath === undefined ? {} : { endpointPath }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    };

    const parsedClient = parseSpeechToTextClientConfig(clientConfig);
    if (parsedClient.isErr()) {
      return Result.err(configError("stt", parsedClient.error.message));
    }

    return Result.ok(
      Object.freeze({
        enabled: true,
        clientConfig,
        ...(language === undefined ? {} : { language }),
        maxBytes,
      } as const),
    );
  });
}

export function parseXmuxConfig(
  config: Config,
): ResultType<NormalizedConfig, XmuxConfigurationError> {
  return Result.gen(function* () {
    const defaultWorkingDirectory = yield* parseDefaultWorkingDirectory(
      config.defaultWorkingDirectory,
    );
    const deliveryMode = yield* parseDeliveryMode(config.deliveryMode);
    const workspace = yield* parseWorkspaceConfig(config.workspace);
    const resume = yield* parseResumeConfig(config.resume);
    const model = yield* parseModelConfig(config.model);
    const prompt = yield* parsePromptConfig(config.prompt);
    const stt = yield* parseSttConfig(config.stt);

    return Result.ok(
      Object.freeze({
        defaultWorkingDirectory,
        deliveryMode,
        workspace,
        resume,
        model,
        prompt,
        stt,
      }),
    );
  });
}

export const parseConfig = parseXmuxConfig;

/**
 * Legacy compatibility wrapper for callers that still expect a synchronous config value.
 * New boundaries should use `parseXmuxConfig` and handle `XmuxConfigurationError` explicitly.
 */
export function normalizeConfig(config: Config): NormalizedConfig {
  const parsed = parseXmuxConfig(config);
  if (parsed.isErr()) throw parsed.error;
  return parsed.value;
}
