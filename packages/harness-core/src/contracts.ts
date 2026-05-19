import type { Result } from "better-result";
import type {
  AbortError,
  CreateSessionError,
  DeleteSessionError,
  GetSessionError,
  HarnessCloseError,
  ListSessionsError,
  PromptError,
  ResumeSessionError,
} from "./errors";
import type { HarnessPromptEvent } from "./events";
import type {
  AbortInput,
  CreateSessionInput,
  CreatedSessionFromInput,
  DeleteSessionInput,
  GetSessionInput,
  GetSessionResultFromInput,
  HarnessAdapterDefinitions,
  ListSessionsInput,
  ListSessionsResultFromInput,
  PromptInput,
  PromptResultFromInput,
  ResumeSessionInput,
  ResumeSessionResultFromInput,
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
  readonly adapterOptions: TAdapterOptions;
  readonly signal?: AbortSignal;
}

/** Adapter-native session metadata returned to the unified harness facade. */
export interface HarnessAdapterCreateSessionResult<TAdapterSession extends HarnessAdapterObject> {
  readonly sessionId: string;
  readonly adapterData: TAdapterSession;
}

/** Adapter-returned existing session data before harness-core validates it. */
export interface HarnessAdapterSessionInfo<
  TAdapterSession extends HarnessAdapterObject = HarnessAdapterObject,
> {
  readonly sessionId: string;
  readonly cwd?: string;
  readonly title?: string;
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
  readonly adapterOptions: TAdapterOptions;
  readonly signal?: AbortSignal;
}

/** Ref-based session request passed to an adapter. */
export interface HarnessAdapterGetSessionInput<
  THarnessId extends string,
  TAdapterSession extends HarnessAdapterObject,
  TAdapterOptions extends HarnessAdapterObject,
> {
  readonly session: HarnessSessionInfo<THarnessId, TAdapterSession>;
  readonly adapterOptions: TAdapterOptions;
  readonly signal?: AbortSignal;
}

/** Prompt request passed to an adapter for a known session. */
export interface HarnessAdapterPromptInput<
  THarnessId extends string,
  TAdapterSession extends HarnessAdapterObject,
  TAdapterOptions extends HarnessAdapterObject,
> {
  readonly session: HarnessSessionInfo<THarnessId, TAdapterSession>;
  readonly content: readonly HarnessPromptContent[];
  readonly adapterOptions: TAdapterOptions;
  readonly signal?: AbortSignal;
}

/** Stream returned by an adapter after prompt setup succeeds. */
export type HarnessAdapterPromptResult<
  THarnessId extends string = string,
  TAdapterData extends HarnessAdapterObject = HarnessAdapterObject,
> = AsyncIterable<HarnessPromptEvent<THarnessId, TAdapterData>>;

/** Delete request passed to an adapter for a known session. */
export interface HarnessAdapterDeleteSessionInput<
  THarnessId extends string,
  TAdapterSession extends HarnessAdapterObject,
  TAdapterOptions extends HarnessAdapterObject,
> {
  readonly session: HarnessSessionInfo<THarnessId, TAdapterSession>;
  readonly adapterOptions: TAdapterOptions;
  readonly signal?: AbortSignal;
}

/** Abort request passed to an adapter for a known session. */
export interface HarnessAdapterAbortInput<
  THarnessId extends string,
  TAdapterSession extends HarnessAdapterObject,
  TAdapterOptions extends HarnessAdapterObject,
> {
  readonly session: HarnessSessionInfo<THarnessId, TAdapterSession>;
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
    input: HarnessAdapterGetSessionInput<THarnessId, TAdapterSession, TAdapterOptions>,
  ): Promise<Result<HarnessAdapterSessionInfo<TAdapterSession>, unknown>>;
  prompt(
    input: HarnessAdapterPromptInput<THarnessId, TAdapterSession, TAdapterOptions>,
  ): Promise<Result<HarnessAdapterPromptResult<THarnessId>, unknown>>;
  deleteSession(
    input: HarnessAdapterDeleteSessionInput<THarnessId, TAdapterSession, TAdapterOptions>,
  ): Promise<Result<void, unknown>>;
  abort(
    input: HarnessAdapterAbortInput<THarnessId, TAdapterSession, TAdapterOptions>,
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
> {
  readonly id: THarnessId;
  open(
    context: OpenHarnessAdapterContext,
  ): Promise<Result<OpenedHarnessAdapter<THarnessId, TAdapterOptions, TAdapterSession>, unknown>>;
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
  getSession<TInput extends GetSessionInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<GetSessionResultFromInput<TAdapters, TInput>, GetSessionError>>;
  prompt<TInput extends PromptInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<PromptResultFromInput<TAdapters, TInput>, PromptError>>;
  deleteSession<TInput extends DeleteSessionInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<void, DeleteSessionError>>;
  abort<TInput extends AbortInput<TAdapters>>(
    input: TInput,
  ): Promise<Result<void, AbortError>>;
  close(): Promise<Result<void, HarnessCloseError>>;
}

/** Options for building the unified harness facade. */
export interface CreateHarnessOptions<TAdapters extends HarnessAdapterDefinitions<TAdapters>> {
  readonly adapters: TAdapters;
  readonly now?: () => Date;
}
