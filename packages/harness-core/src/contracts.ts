import type { Result } from "better-result";
import type {
  AbortError,
  CreateSessionError,
  DeleteSessionError,
  GetModelError,
  GetSessionError,
  GetThinkingError,
  HarnessCloseError,
  ListModelsError,
  RespondInteractionError,
  ListSessionsError,
  PromptError,
  ResumeSessionError,
  SetModelError,
  SetThinkingError,
} from "./errors";
import type { HarnessPromptEvent } from "./events";
import type {
  AbortInput,
  CreateSessionInput,
  CreatedSessionFromInput,
  DeleteSessionInput,
  GetModelInput,
  GetModelResultFromInput,
  GetSessionInput,
  GetThinkingInput,
  GetThinkingResultFromInput,
  GetSessionResultFromInput,
  HarnessAdapterDefinitions,
  ListModelsInput,
  ListModelsResultFromInput,
  ListSessionsInput,
  ListSessionsResultFromInput,
  PromptInput,
  PromptResultFromInput,
  RespondInteractionInput,
  ResumeSessionInput,
  ResumeSessionResultFromInput,
  SetModelInput,
  SetModelResultFromInput,
  SetThinkingInput,
  SetThinkingResultFromInput,
} from "./types";

declare const workingDirectoryPathBrand: unique symbol;

/**
 * Absolute working directory that has already been validated by harness-core.
 * Adapters can trust this value instead of re-checking filesystem existence.
 */
export type WorkingDirectoryPath = string & { readonly [workingDirectoryPathBrand]: true };

export type HarnessAdapterObject = Record<string, unknown>;

/** Identifies a session in both the unified xmux world and the native harness. */
export interface SessionRef<THarnessId extends string = string> {
  readonly harnessId: THarnessId;
  readonly sessionId: string;
}

/** Provider/model identity reported by a harness when available. */
export interface HarnessModelRef {
  readonly providerId?: string;
  readonly modelId: string;
  readonly variant?: string;
}

/** Model metadata normalized across harnesses. */
export interface HarnessModelInfo<
  THarnessId extends string = string,
  TAdapterModel extends HarnessAdapterObject = HarnessAdapterObject,
> {
  readonly harnessId: THarnessId;
  readonly ref: HarnessModelRef;
  readonly name?: string;
  readonly providerName?: string;
  readonly status?: "active" | "beta" | "deprecated" | "unavailable";
  readonly available?: boolean;
  readonly capabilities?: {
    readonly tools?: boolean;
    readonly reasoning?: boolean;
    readonly thinking?: {
      readonly supportedLevels: readonly HarnessThinkingLevel[];
      readonly defaultLevel?: HarnessThinkingLevel;
    };
    readonly temperature?: boolean;
    readonly input?: readonly ("text" | "image" | "audio" | "video" | "pdf")[];
    readonly output?: readonly ("text" | "image" | "audio" | "video" | "pdf")[];
  };
  readonly limits?: {
    readonly context?: number;
    readonly input?: number;
    readonly output?: number;
  };
  readonly cost?: {
    readonly input?: number;
    readonly output?: number;
    readonly cacheRead?: number;
    readonly cacheWrite?: number;
  };
  readonly adapterData: TAdapterModel;
}

/** Canonical xmux thinking scale adapters translate to native provider controls. */
export type HarnessThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** Adapter mapping from xmux thinking levels to native values; null means explicitly unsupported. */
export type HarnessThinkingLevelMap<TNative = string> = Partial<
  Record<HarnessThinkingLevel, TNative | null>
>;

/** Scope whose selected/default model should be read or updated. */
export type HarnessModelTarget<THarnessId extends string = string> =
  | { readonly type: "harness"; readonly harnessId: THarnessId }
  | { readonly type: "session"; readonly ref: SessionRef<THarnessId> };

/** Model selection mutation for a harness or session target. */
export type HarnessModelUpdate =
  | { readonly type: "set"; readonly model: HarnessModelRef }
  | { readonly type: "clear" };

/** Current model selection for a harness or session target. */
export interface HarnessSelectedModel<THarnessId extends string = string> {
  readonly target: HarnessModelTarget<THarnessId>;
  readonly model?: HarnessModelRef;
  readonly source: "session" | "harness" | "native" | "unset";
}

/** Scope whose selected/default thinking level should be read or updated. */
export type HarnessThinkingTarget<THarnessId extends string = string> =
  HarnessModelTarget<THarnessId>;

/** Thinking selection mutation for a harness or session target. */
export type HarnessThinkingUpdate =
  | { readonly type: "set"; readonly level: HarnessThinkingLevel }
  | { readonly type: "clear" };

/** Current thinking selection for a harness or session target. */
export interface HarnessSelectedThinking<THarnessId extends string = string> {
  readonly target: HarnessThinkingTarget<THarnessId>;
  readonly level?: HarnessThinkingLevel;
  readonly supportedLevels?: readonly HarnessThinkingLevel[];
  readonly source: "session" | "harness" | "native" | "unset";
}

/** Token usage data normalized across harnesses. */
export interface HarnessTokenUsage {
  readonly input?: number;
  readonly output?: number;
  readonly reasoning?: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
  readonly total?: number;
}

/** Tool output content that can be rendered by xmux consumers. */
export type HarnessToolOutput =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType: string }
  | { readonly type: "json"; readonly value: unknown };

/** User prompt content accepted by the unified harness facade. */
export type HarnessPromptContent =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "image";
      readonly data: string;
      readonly mimeType: string;
      readonly name?: string;
    }
  | {
      readonly type: "file";
      readonly uri: string;
      readonly mime: string;
      readonly name?: string;
      readonly description?: string;
    };

/** Session metadata for existing sessions known to a harness. */
export interface HarnessSessionInfo<
  THarnessId extends string = string,
  TAdapterSession extends HarnessAdapterObject = HarnessAdapterObject,
> {
  readonly ref: SessionRef<THarnessId>;
  readonly cwd?: WorkingDirectoryPath;
  readonly title?: string;
  readonly model?: HarnessModelRef;
  readonly adapterData: TAdapterSession;
}

/** Shared runtime inputs passed to adapter startup. */
export interface OpenHarnessAdapterContext {
  readonly signal?: AbortSignal;
}

/** Common session creation fields every adapter receives from harness-core. */
export interface HarnessAdapterCreateSessionInput<TAdapterOptions extends HarnessAdapterObject> {
  readonly cwd: WorkingDirectoryPath;
  readonly title?: string;
  readonly model?: HarnessModelRef;
  readonly thinking?: HarnessThinkingLevel;
  readonly adapterOptions: TAdapterOptions;
  readonly signal?: AbortSignal;
}

/** Adapter-native session metadata returned to the unified harness facade. */
export interface HarnessAdapterCreateSessionResult<TAdapterSession extends HarnessAdapterObject> {
  readonly sessionId: string;
  readonly model?: HarnessModelRef;
  readonly adapterData: TAdapterSession;
}

/** Adapter-returned existing session data before harness-core validates it. */
export interface HarnessAdapterSessionInfo<
  TAdapterSession extends HarnessAdapterObject = HarnessAdapterObject,
> {
  readonly sessionId: string;
  readonly cwd?: string;
  readonly title?: string;
  readonly model?: HarnessModelRef;
  readonly adapterData: TAdapterSession;
}

/** Resume request passed to an adapter. */
export interface HarnessAdapterResumeSessionInput<TAdapterOptions extends HarnessAdapterObject> {
  readonly sessionId: string;
  readonly cwd?: WorkingDirectoryPath;
  readonly adapterOptions: TAdapterOptions;
  readonly signal?: AbortSignal;
}

/** List request passed to an adapter. */
export interface HarnessAdapterListSessionsInput<TAdapterOptions extends HarnessAdapterObject> {
  readonly cwd?: string;
  readonly adapterOptions: TAdapterOptions;
  readonly signal?: AbortSignal;
}

/** Model list request passed to an adapter. */
export interface HarnessAdapterListModelsInput<TAdapterOptions extends HarnessAdapterObject> {
  readonly cwd?: string;
  readonly includeUnavailable?: boolean;
  readonly adapterOptions: TAdapterOptions;
  readonly signal?: AbortSignal;
}

/** Ref-based session request passed to an adapter. */
export interface HarnessAdapterGetSessionInput<
  THarnessId extends string,
  TAdapterOptions extends HarnessAdapterObject,
> {
  readonly ref: SessionRef<THarnessId>;
  readonly adapterOptions: TAdapterOptions;
  readonly signal?: AbortSignal;
}

/** Prompt request passed to an adapter. */
export interface HarnessAdapterPromptInput<
  THarnessId extends string,
  TAdapterOptions extends HarnessAdapterObject,
> {
  readonly ref: SessionRef<THarnessId>;
  readonly cwd: WorkingDirectoryPath;
  readonly content: readonly HarnessPromptContent[];
  readonly model?: HarnessModelRef;
  readonly thinking?: HarnessThinkingLevel;
  readonly adapterOptions: TAdapterOptions;
  readonly signal?: AbortSignal;
}

/** Stream returned by an adapter after prompt setup succeeds. */
export type HarnessAdapterPromptResult<
  THarnessId extends string = string,
  TAdapterData extends HarnessAdapterObject = HarnessAdapterObject,
> = AsyncIterable<HarnessPromptEvent<THarnessId, TAdapterData>>;

/** Model selection read request passed to an adapter. */
export interface HarnessAdapterGetModelInput<
  THarnessId extends string,
  TAdapterOptions extends HarnessAdapterObject,
> {
  readonly target: HarnessModelTarget<THarnessId>;
  readonly adapterOptions: TAdapterOptions;
  readonly signal?: AbortSignal;
}

/** Model selection write request passed to an adapter. */
export interface HarnessAdapterSetModelInput<
  THarnessId extends string,
  TAdapterOptions extends HarnessAdapterObject,
> {
  readonly target: HarnessModelTarget<THarnessId>;
  readonly update: HarnessModelUpdate;
  readonly adapterOptions: TAdapterOptions;
  readonly signal?: AbortSignal;
}

/** Thinking selection read request passed to an adapter. */
export interface HarnessAdapterGetThinkingInput<
  THarnessId extends string,
  TAdapterOptions extends HarnessAdapterObject,
> {
  readonly target: HarnessThinkingTarget<THarnessId>;
  readonly adapterOptions: TAdapterOptions;
  readonly signal?: AbortSignal;
}

/** Thinking selection write request passed to an adapter. */
export interface HarnessAdapterSetThinkingInput<
  THarnessId extends string,
  TAdapterOptions extends HarnessAdapterObject,
> {
  readonly target: HarnessThinkingTarget<THarnessId>;
  readonly update: HarnessThinkingUpdate;
  readonly adapterOptions: TAdapterOptions;
  readonly signal?: AbortSignal;
}

/** Delete request passed to an adapter. */
export interface HarnessAdapterDeleteSessionInput<
  THarnessId extends string,
  TAdapterOptions extends HarnessAdapterObject,
> {
  readonly ref: SessionRef<THarnessId>;
  readonly adapterOptions: TAdapterOptions;
  readonly signal?: AbortSignal;
}

export type HarnessPermissionDecision = "allow_once" | "allow_always" | "reject";

export type HarnessInteractionResponse =
  | {
      readonly kind: "permission";
      readonly requestId: string;
      readonly decision: HarnessPermissionDecision;
      readonly message?: string;
    }
  | {
      readonly kind: "question";
      readonly requestId: string;
      readonly answers?: readonly (readonly string[])[];
      readonly reject?: boolean;
    };

/** Abort request passed to an adapter. */
export interface HarnessAdapterAbortInput<
  THarnessId extends string,
  TAdapterOptions extends HarnessAdapterObject,
> {
  readonly ref: SessionRef<THarnessId>;
  readonly adapterOptions: TAdapterOptions;
  readonly signal?: AbortSignal;
}

/** Interaction response request passed to an adapter. */
export interface HarnessAdapterRespondInteractionInput<
  THarnessId extends string,
  TAdapterOptions extends HarnessAdapterObject,
> {
  readonly ref: SessionRef<THarnessId>;
  readonly cwd?: WorkingDirectoryPath;
  readonly response: HarnessInteractionResponse;
  readonly adapterOptions: TAdapterOptions;
  readonly signal?: AbortSignal;
}

/**
 * Live adapter runtime.
 *
 * This is what an adapter returns after `open()`. It owns any SDK clients,
 * subprocesses, sockets, or other resources needed to talk to the harness.
 */
export interface OpenedHarnessAdapter<
  THarnessId extends string,
  TAdapterOptions extends HarnessAdapterObject = Record<never, never>,
  TAdapterSession extends HarnessAdapterObject = Record<never, never>,
  TAdapterModel extends HarnessAdapterObject = HarnessAdapterObject,
> {
  readonly id: THarnessId;
  createSession(
    input: HarnessAdapterCreateSessionInput<TAdapterOptions>,
  ): Promise<Result<HarnessAdapterCreateSessionResult<TAdapterSession>, unknown>>;
  resumeSession(
    input: HarnessAdapterResumeSessionInput<TAdapterOptions>,
  ): Promise<Result<HarnessAdapterSessionInfo<TAdapterSession>, unknown>>;
  listSessions(
    input: HarnessAdapterListSessionsInput<TAdapterOptions>,
  ): Promise<Result<readonly HarnessAdapterSessionInfo<TAdapterSession>[], unknown>>;
  getSession(
    input: HarnessAdapterGetSessionInput<THarnessId, TAdapterOptions>,
  ): Promise<Result<HarnessAdapterSessionInfo<TAdapterSession>, unknown>>;
  prompt(
    input: HarnessAdapterPromptInput<THarnessId, TAdapterOptions>,
  ): Promise<Result<HarnessAdapterPromptResult<THarnessId>, unknown>>;
  listModels?(
    input: HarnessAdapterListModelsInput<TAdapterOptions>,
  ): Promise<Result<readonly HarnessModelInfo<THarnessId, TAdapterModel>[], unknown>>;
  getModel?(
    input: HarnessAdapterGetModelInput<THarnessId, TAdapterOptions>,
  ): Promise<Result<HarnessSelectedModel<THarnessId>, unknown>>;
  setModel?(
    input: HarnessAdapterSetModelInput<THarnessId, TAdapterOptions>,
  ): Promise<Result<HarnessSelectedModel<THarnessId>, unknown>>;
  getThinking?(
    input: HarnessAdapterGetThinkingInput<THarnessId, TAdapterOptions>,
  ): Promise<Result<HarnessSelectedThinking<THarnessId>, unknown>>;
  setThinking?(
    input: HarnessAdapterSetThinkingInput<THarnessId, TAdapterOptions>,
  ): Promise<Result<HarnessSelectedThinking<THarnessId>, unknown>>;
  deleteSession(
    input: HarnessAdapterDeleteSessionInput<THarnessId, TAdapterOptions>,
  ): Promise<Result<void, unknown>>;
  abort(
    input: HarnessAdapterAbortInput<THarnessId, TAdapterOptions>,
  ): Promise<Result<void, unknown>>;
  respondInteraction?(
    input: HarnessAdapterRespondInteractionInput<THarnessId, TAdapterOptions>,
  ): Promise<Result<void, unknown>>;
  close(): Promise<void>;
}

/**
 * Adapter factory contract implemented by packages like `@xmux/harness-pi`.
 *
 * `open()` should create or acquire a runtime that can service session requests.
 */
export interface HarnessAdapterDefinition<
  THarnessId extends string,
  TAdapterOptions extends HarnessAdapterObject = Record<never, never>,
  TAdapterSession extends HarnessAdapterObject = Record<never, never>,
  TAdapterModel extends HarnessAdapterObject = HarnessAdapterObject,
> {
  readonly id: THarnessId;
  open(
    context: OpenHarnessAdapterContext,
  ): Promise<
    Result<
      OpenedHarnessAdapter<THarnessId, TAdapterOptions, TAdapterSession, TAdapterModel>,
      unknown
    >
  >;
}

/**
 * Unified facade exposed to library consumers.
 *
 * Callers choose a harness with `harnessId`, while the type system narrows the
 * adapter-specific input and output for that selection.
 */
export interface Harness<TAdapters extends HarnessAdapterDefinitions<TAdapters>> {
  readonly harnessIds: readonly Extract<keyof TAdapters, string>[];
  createSession<TInput extends CreateSessionInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<CreatedSessionFromInput<TAdapters, TInput>, CreateSessionError>>;
  resumeSession<TInput extends ResumeSessionInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<ResumeSessionResultFromInput<TAdapters, TInput>, ResumeSessionError>>;
  listSessions<TInput extends ListSessionsInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<ListSessionsResultFromInput<TAdapters, TInput>, ListSessionsError>>;
  listModels<TInput extends ListModelsInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<ListModelsResultFromInput<TAdapters, TInput>, ListModelsError>>;
  getModel<TInput extends GetModelInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<GetModelResultFromInput<TAdapters, TInput>, GetModelError>>;
  setModel<TInput extends SetModelInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<SetModelResultFromInput<TAdapters, TInput>, SetModelError>>;
  getThinking<TInput extends GetThinkingInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<GetThinkingResultFromInput<TAdapters, TInput>, GetThinkingError>>;
  setThinking<TInput extends SetThinkingInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<SetThinkingResultFromInput<TAdapters, TInput>, SetThinkingError>>;
  getSession<TInput extends GetSessionInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<GetSessionResultFromInput<TAdapters, TInput>, GetSessionError>>;
  prompt<TInput extends PromptInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<PromptResultFromInput<TAdapters, TInput>, PromptError>>;
  deleteSession<TInput extends DeleteSessionInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<void, DeleteSessionError>>;
  abort<TInput extends AbortInput<TAdapters>>(input: TInput): Promise<Result<void, AbortError>>;
  respondInteraction<TInput extends RespondInteractionInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<void, RespondInteractionError>>;
  close(): Promise<Result<void, HarnessCloseError>>;
}

/** Options for building the unified harness facade. */
export interface CreateHarnessOptions<TAdapters extends HarnessAdapterDefinitions<TAdapters>> {
  readonly adapters: TAdapters;
  readonly now?: () => Date;
}
