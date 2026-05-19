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
  HarnessSessionInfo,
  OpenedHarnessAdapter,
  WorkingDirectoryPath,
} from "../contracts";
import type { AdapterOptionsFor, AdapterSessionFor, HarnessAdapterDefinitions } from "../types";

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
      AdapterSessionFor<TAdapters, THarnessId>
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

export function createStubCause(operation: string): Error {
  return new Error(`${operation} facade behavior is not implemented yet`);
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
>(args: {
  readonly adapter: HarnessAdapterDefinition<THarnessId, TAdapterOptions, TAdapterSession>;
  readonly harnessId: THarnessId;
  readonly signal?: AbortSignal;
}): Promise<
  Result<
    OpenedHarnessAdapter<THarnessId, TAdapterOptions, TAdapterSession>,
    HarnessAdapterOpenError
  >
> {
  const opened = await args.adapter.open({ signal: args.signal });

  return opened.isErr()
    ? Result.err(new HarnessAdapterOpenError({ harnessId: args.harnessId, cause: opened.error }))
    : Result.ok(opened.value);
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
  const created = await args.runtime.createSession(args.input);

  return created.isErr()
    ? Result.err(
        new HarnessAdapterCreateSessionError({
          harnessId: args.harnessId,
          cause: created.error,
        }),
      )
    : Result.ok(created.value);
}

export async function createHarnessSessionInfo<
  THarnessId extends string,
  TAdapterSession extends HarnessAdapterObject,
>(args: {
  readonly harnessId: THarnessId;
  readonly adapterSession: HarnessAdapterSessionInfo<TAdapterSession>;
}): Promise<Result<HarnessSessionInfo<THarnessId, TAdapterSession>, InvalidWorkingDirectoryError>> {
  if (args.adapterSession.cwd === undefined) {
    return Result.ok({
      ref: {
        harnessId: args.harnessId,
        sessionId: args.adapterSession.sessionId,
      },
      title: args.adapterSession.title,
      adapterData: args.adapterSession.adapterData,
    });
  }

  const cwd = await createWorkingDirectoryPath(args.adapterSession.cwd);
  if (cwd.isErr()) {
    return Result.err(cwd.error);
  }

  return Result.ok({
    ref: {
      harnessId: args.harnessId,
      sessionId: args.adapterSession.sessionId,
    },
    cwd: cwd.value,
    title: args.adapterSession.title,
    adapterData: args.adapterSession.adapterData,
  });
}
