import type {
  HarnessAdapterDefinition,
  HarnessAdapterObject,
  SessionRef,
  WorkingDirectoryPath,
} from "./contracts";

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
