import type {
  HarnessAdapterDefinition,
  HarnessAdapterObject,
  HarnessPromptContent,
  HarnessSessionInfo,
  SessionRef,
  WorkingDirectoryPath,
} from "./contracts";
import type { HarnessPromptEvent } from "./events";

type AnyHarnessAdapterDefinition = HarnessAdapterDefinition<
  string,
  HarnessAdapterObject,
  HarnessAdapterObject
>;

export type AdapterOptionsFor<
  TAdapters extends Record<string, AnyHarnessAdapterDefinition>,
  THarnessId extends keyof TAdapters,
> =
  TAdapters[THarnessId] extends HarnessAdapterDefinition<
    string,
    infer TAdapterOptions extends HarnessAdapterObject,
    HarnessAdapterObject
  >
    ? TAdapterOptions
    : never;

export type AdapterSessionFor<
  TAdapters extends Record<string, AnyHarnessAdapterDefinition>,
  THarnessId extends keyof TAdapters,
> =
  TAdapters[THarnessId] extends HarnessAdapterDefinition<
    string,
    HarnessAdapterObject,
    infer TAdapterSession extends HarnessAdapterObject
  >
    ? TAdapterSession
    : never;

export type AdapterResumeOptionsFor<
  TAdapters extends Record<string, AnyHarnessAdapterDefinition>,
  THarnessId extends keyof TAdapters,
> = AdapterOptionsFor<TAdapters, THarnessId>;

export type AdapterListOptionsFor<
  TAdapters extends Record<string, AnyHarnessAdapterDefinition>,
  THarnessId extends keyof TAdapters,
> = AdapterOptionsFor<TAdapters, THarnessId>;

export type AdapterGetOptionsFor<
  TAdapters extends Record<string, AnyHarnessAdapterDefinition>,
  THarnessId extends keyof TAdapters,
> = AdapterOptionsFor<TAdapters, THarnessId>;

export type AdapterPromptOptionsFor<
  TAdapters extends Record<string, AnyHarnessAdapterDefinition>,
  THarnessId extends keyof TAdapters,
> = AdapterOptionsFor<TAdapters, THarnessId>;

export type AdapterDeleteOptionsFor<
  TAdapters extends Record<string, AnyHarnessAdapterDefinition>,
  THarnessId extends keyof TAdapters,
> = AdapterOptionsFor<TAdapters, THarnessId>;

export type AdapterAbortOptionsFor<
  TAdapters extends Record<string, AnyHarnessAdapterDefinition>,
  THarnessId extends keyof TAdapters,
> = AdapterOptionsFor<TAdapters, THarnessId>;

type RequiredKeys<TValue extends HarnessAdapterObject> = {
  [TKey in keyof TValue]-?: {} extends Pick<TValue, TKey> ? never : TKey;
}[keyof TValue];

type AdapterOptionsProp<TAdapterOptions extends HarnessAdapterObject> = [
  RequiredKeys<TAdapterOptions>,
] extends [never]
  ? { readonly adapterOptions?: TAdapterOptions }
  : { readonly adapterOptions: TAdapterOptions };

export type HarnessAdapterDefinitions<
  TAdapters extends Record<string, AnyHarnessAdapterDefinition>,
> = {
  readonly [THarnessId in keyof TAdapters]: HarnessAdapterDefinition<
    Extract<THarnessId, string>,
    AdapterOptionsFor<TAdapters, THarnessId>,
    AdapterSessionFor<TAdapters, THarnessId>
  >;
};

export type CreateSessionInputFor<
  TAdapters extends Record<string, AnyHarnessAdapterDefinition>,
  THarnessId extends keyof TAdapters,
> = {
  readonly harnessId: Extract<THarnessId, string>;
  readonly cwd: string;
  readonly title?: string;
  readonly signal?: AbortSignal;
} & AdapterOptionsProp<AdapterOptionsFor<TAdapters, THarnessId>>;

export type CreateSessionInput<TAdapters extends Record<string, AnyHarnessAdapterDefinition>> = {
  readonly [THarnessId in keyof TAdapters]: CreateSessionInputFor<TAdapters, THarnessId>;
}[keyof TAdapters];

export type CreatedSessionFor<
  TAdapters extends Record<string, AnyHarnessAdapterDefinition>,
  THarnessId extends keyof TAdapters,
> = {
  readonly ref: SessionRef<Extract<THarnessId, string>>;
  readonly cwd: WorkingDirectoryPath;
  readonly title?: string;
  readonly createdAt: string;
  readonly adapterData: AdapterSessionFor<TAdapters, THarnessId>;
};

export type CreatedSession<TAdapters extends Record<string, AnyHarnessAdapterDefinition>> = {
  readonly [THarnessId in keyof TAdapters]: CreatedSessionFor<TAdapters, THarnessId>;
}[keyof TAdapters];

export type CreatedSessionFromInput<
  TAdapters extends Record<string, AnyHarnessAdapterDefinition>,
  TInput,
> = TInput extends { readonly harnessId: infer THarnessId extends keyof TAdapters }
  ? CreatedSessionFor<TAdapters, THarnessId>
  : never;

export type HarnessSessionInfoFor<
  TAdapters extends Record<string, AnyHarnessAdapterDefinition>,
  THarnessId extends keyof TAdapters,
> = HarnessSessionInfo<Extract<THarnessId, string>, AdapterSessionFor<TAdapters, THarnessId>>;

export type ResumeSessionInputFor<
  TAdapters extends Record<string, AnyHarnessAdapterDefinition>,
  THarnessId extends keyof TAdapters,
> = {
  readonly harnessId: Extract<THarnessId, string>;
  readonly sessionId: string;
  readonly cwd?: string;
  readonly signal?: AbortSignal;
} & AdapterOptionsProp<AdapterOptionsFor<TAdapters, THarnessId>>;

export type ResumeSessionInput<TAdapters extends Record<string, AnyHarnessAdapterDefinition>> = {
  readonly [THarnessId in keyof TAdapters]: ResumeSessionInputFor<TAdapters, THarnessId>;
}[keyof TAdapters];

export type ResumeSessionResultFor<
  TAdapters extends Record<string, AnyHarnessAdapterDefinition>,
  THarnessId extends keyof TAdapters,
> = HarnessSessionInfoFor<TAdapters, THarnessId>;

export type ResumeSessionResultFromInput<
  TAdapters extends Record<string, AnyHarnessAdapterDefinition>,
  TInput,
> = TInput extends { readonly harnessId: infer THarnessId extends keyof TAdapters }
  ? ResumeSessionResultFor<TAdapters, THarnessId>
  : never;

export type ListSessionsInputFor<
  TAdapters extends Record<string, AnyHarnessAdapterDefinition>,
  THarnessId extends keyof TAdapters,
> = {
  readonly harnessId: Extract<THarnessId, string>;
  readonly signal?: AbortSignal;
} & AdapterOptionsProp<AdapterOptionsFor<TAdapters, THarnessId>>;

export type ListSessionsInput<TAdapters extends Record<string, AnyHarnessAdapterDefinition>> = {
  readonly [THarnessId in keyof TAdapters]: ListSessionsInputFor<TAdapters, THarnessId>;
}[keyof TAdapters];

export type ListSessionsResultFor<
  TAdapters extends Record<string, AnyHarnessAdapterDefinition>,
  THarnessId extends keyof TAdapters,
> = readonly HarnessSessionInfoFor<TAdapters, THarnessId>[];

export type ListSessionsResultFromInput<
  TAdapters extends Record<string, AnyHarnessAdapterDefinition>,
  TInput,
> = TInput extends { readonly harnessId: infer THarnessId extends keyof TAdapters }
  ? ListSessionsResultFor<TAdapters, THarnessId>
  : never;

export type GetSessionInputFor<
  TAdapters extends Record<string, AnyHarnessAdapterDefinition>,
  THarnessId extends keyof TAdapters,
> = {
  readonly ref: SessionRef<Extract<THarnessId, string>>;
  readonly signal?: AbortSignal;
} & AdapterOptionsProp<AdapterOptionsFor<TAdapters, THarnessId>>;

export type GetSessionInput<TAdapters extends Record<string, AnyHarnessAdapterDefinition>> = {
  readonly [THarnessId in keyof TAdapters]: GetSessionInputFor<TAdapters, THarnessId>;
}[keyof TAdapters];

export type GetSessionResultFor<
  TAdapters extends Record<string, AnyHarnessAdapterDefinition>,
  THarnessId extends keyof TAdapters,
> = HarnessSessionInfoFor<TAdapters, THarnessId>;

export type GetSessionResultFromInput<
  TAdapters extends Record<string, AnyHarnessAdapterDefinition>,
  TInput,
> = TInput extends { readonly ref: { readonly harnessId: infer THarnessId extends keyof TAdapters } }
  ? GetSessionResultFor<TAdapters, THarnessId>
  : never;

export type PromptContentInput = HarnessPromptContent | readonly HarnessPromptContent[];

export type PromptInputFor<
  TAdapters extends Record<string, AnyHarnessAdapterDefinition>,
  THarnessId extends keyof TAdapters,
> = {
  readonly ref: SessionRef<Extract<THarnessId, string>>;
  readonly content: PromptContentInput;
  readonly signal?: AbortSignal;
} & AdapterOptionsProp<AdapterOptionsFor<TAdapters, THarnessId>>;

export type PromptInput<TAdapters extends Record<string, AnyHarnessAdapterDefinition>> = {
  readonly [THarnessId in keyof TAdapters]: PromptInputFor<TAdapters, THarnessId>;
}[keyof TAdapters];

export type PromptResultFor<
  TAdapters extends Record<string, AnyHarnessAdapterDefinition>,
  THarnessId extends keyof TAdapters,
> = AsyncIterable<HarnessPromptEvent<Extract<THarnessId, string>>>;

export type PromptResultFromInput<
  TAdapters extends Record<string, AnyHarnessAdapterDefinition>,
  TInput,
> = TInput extends { readonly ref: { readonly harnessId: infer THarnessId extends keyof TAdapters } }
  ? PromptResultFor<TAdapters, THarnessId>
  : never;

export type DeleteSessionInputFor<
  TAdapters extends Record<string, AnyHarnessAdapterDefinition>,
  THarnessId extends keyof TAdapters,
> = {
  readonly ref: SessionRef<Extract<THarnessId, string>>;
  readonly signal?: AbortSignal;
} & AdapterOptionsProp<AdapterOptionsFor<TAdapters, THarnessId>>;

export type DeleteSessionInput<TAdapters extends Record<string, AnyHarnessAdapterDefinition>> = {
  readonly [THarnessId in keyof TAdapters]: DeleteSessionInputFor<TAdapters, THarnessId>;
}[keyof TAdapters];

export type DeleteSessionResult = void;

export type AbortInputFor<
  TAdapters extends Record<string, AnyHarnessAdapterDefinition>,
  THarnessId extends keyof TAdapters,
> = {
  readonly ref: SessionRef<Extract<THarnessId, string>>;
  readonly signal?: AbortSignal;
} & AdapterOptionsProp<AdapterOptionsFor<TAdapters, THarnessId>>;

export type AbortInput<TAdapters extends Record<string, AnyHarnessAdapterDefinition>> = {
  readonly [THarnessId in keyof TAdapters]: AbortInputFor<TAdapters, THarnessId>;
}[keyof TAdapters];

export type AbortResult = void;
