import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { Result } from "better-result";
import {
  HarnessAdapterCreateSessionError,
  HarnessAdapterOpenError,
  InvalidWorkingDirectoryError,
  UnknownHarnessError,
} from "../errors";
import type {
  HarnessAdapterCreateSessionInput,
  HarnessAdapterCreateSessionResult,
  HarnessAdapterDefinition,
  HarnessAdapterObject,
  HarnessAdapterSessionInfo,
  HarnessModelTarget,
  HarnessPromptContent,
  HarnessSessionInfo,
  OpenedHarnessAdapter,
  WorkingDirectoryPath,
} from "../contracts";
import type {
  AdapterModelFor,
  AdapterOptionsFor,
  AdapterSessionFor,
  HarnessAdapterDefinitions,
  ModelTargetHarnessId,
} from "../types";

export type HarnessRuntimeGetter<TAdapters extends HarnessAdapterDefinitions<TAdapters>> = <
  THarnessId extends keyof TAdapters,
>(
  harnessId: THarnessId,
  signal?: AbortSignal,
) => Promise<
  Result<
    OpenedHarnessAdapter<
      Extract<THarnessId, string>,
      AdapterOptionsFor<TAdapters, THarnessId>,
      AdapterSessionFor<TAdapters, THarnessId>,
      AdapterModelFor<TAdapters, THarnessId>
    >,
    UnknownHarnessError | HarnessAdapterOpenError
  >
>;

export function normalizeAdapterOptions<TAdapterOptions extends HarnessAdapterObject>(
  adapterOptions: TAdapterOptions | undefined,
): TAdapterOptions {
  return (adapterOptions ?? {}) as TAdapterOptions;
}

export function adapterOptionsFromInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  THarnessId extends keyof TAdapters,
>(input: {
  readonly adapterOptions?: AdapterOptionsFor<TAdapters, THarnessId>;
}): AdapterOptionsFor<TAdapters, THarnessId> {
  return normalizeAdapterOptions("adapterOptions" in input ? input.adapterOptions : undefined);
}

export function normalizePromptContent(
  content: HarnessPromptContent | readonly HarnessPromptContent[],
): readonly HarnessPromptContent[] {
  return Array.isArray(content)
    ? (content as readonly HarnessPromptContent[])
    : [content as HarnessPromptContent];
}

export function modelTargetHarnessId<TTarget extends HarnessModelTarget>(
  target: TTarget,
): ModelTargetHarnessId<TTarget> {
  return (
    target.type === "harness" ? target.harnessId : target.ref.harnessId
  ) as ModelTargetHarnessId<TTarget>;
}

export async function createWorkingDirectoryPath(
  cwd: string,
): Promise<Result<WorkingDirectoryPath, InvalidWorkingDirectoryError>> {
  const normalizedCwd = resolve(cwd);

  return Result.tryPromise({
    try: async () => {
      const stats = await stat(normalizedCwd);
      if (!stats.isDirectory()) {
        throw new InvalidWorkingDirectoryError({
          cwd,
          reason: `Working directory is not a directory: ${normalizedCwd}`,
        });
      }

      return normalizedCwd as WorkingDirectoryPath;
    },
    catch: (cause) =>
      InvalidWorkingDirectoryError.is(cause)
        ? cause
        : new InvalidWorkingDirectoryError({
            cwd,
            cause,
            reason: `Working directory does not exist or is not accessible: ${normalizedCwd}`,
          }),
  });
}

export async function openHarnessAdapter<
  THarnessId extends string,
  TAdapterOptions extends HarnessAdapterObject,
  TAdapterSession extends HarnessAdapterObject,
  TAdapterModel extends HarnessAdapterObject,
>(args: {
  readonly adapter: HarnessAdapterDefinition<
    THarnessId,
    TAdapterOptions,
    TAdapterSession,
    TAdapterModel
  >;
  readonly harnessId: THarnessId;
  readonly signal?: AbortSignal;
}): Promise<
  Result<
    OpenedHarnessAdapter<THarnessId, TAdapterOptions, TAdapterSession, TAdapterModel>,
    HarnessAdapterOpenError
  >
> {
  return Result.mapError(
    await args.adapter.open({ signal: args.signal }),
    (cause) => new HarnessAdapterOpenError({ harnessId: args.harnessId, cause }),
  );
}

export async function createAdapterSession<
  THarnessId extends string,
  TAdapterOptions extends HarnessAdapterObject,
  TAdapterSession extends HarnessAdapterObject,
>(args: {
  readonly runtime: OpenedHarnessAdapter<THarnessId, TAdapterOptions, TAdapterSession>;
  readonly harnessId: THarnessId;
  readonly input: HarnessAdapterCreateSessionInput<TAdapterOptions>;
}): Promise<
  Result<HarnessAdapterCreateSessionResult<TAdapterSession>, HarnessAdapterCreateSessionError>
> {
  return Result.mapError(
    await args.runtime.createSession(args.input),
    (cause) => new HarnessAdapterCreateSessionError({ harnessId: args.harnessId, cause }),
  );
}

export async function createHarnessSessionInfo<
  THarnessId extends string,
  TAdapterSession extends HarnessAdapterObject,
>(args: {
  readonly harnessId: THarnessId;
  readonly adapterSession: HarnessAdapterSessionInfo<TAdapterSession>;
}): Promise<Result<HarnessSessionInfo<THarnessId, TAdapterSession>, InvalidWorkingDirectoryError>> {
  const baseSessionInfo = {
    ref: {
      harnessId: args.harnessId,
      sessionId: args.adapterSession.sessionId,
    },
    title: args.adapterSession.title,
    model: args.adapterSession.model,
    adapterData: args.adapterSession.adapterData,
  } as const;

  if (args.adapterSession.cwd === undefined) {
    return Result.ok(baseSessionInfo);
  }

  return Result.map(await createWorkingDirectoryPath(args.adapterSession.cwd), (cwd) => ({
    ...baseSessionInfo,
    cwd,
  }));
}
