import type { Result } from "better-result";
import type { CreateSessionError, HarnessCloseError } from "./errors";
import type {
  CreateSessionInput,
  CreatedSessionFromInput,
  HarnessAdapterDefinitions,
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
  close(): Promise<Result<void, HarnessCloseError>>;
}

/** Options for building the unified harness facade. */
export interface CreateHarnessOptions<TAdapters extends HarnessAdapterDefinitions<TAdapters>> {
  readonly adapters: TAdapters;
  readonly now?: () => Date;
}
