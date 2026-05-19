import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { Result } from "better-result";
import {
  HarnessAdapterAbortError,
  HarnessAdapterCreateSessionError,
  HarnessAdapterDeleteSessionError,
  HarnessAdapterGetSessionError,
  HarnessAdapterListSessionsError,
  HarnessAdapterOpenError,
  HarnessAdapterPromptError,
  HarnessAdapterResumeSessionError,
  HarnessCloseError,
  InvalidWorkingDirectoryError,
  UnknownHarnessError,
  UnknownSessionError,
} from "./errors";
import type {
  CreateHarnessOptions,
  HarnessAdapterCreateSessionInput,
  HarnessAdapterCreateSessionResult,
  Harness,
  HarnessAdapterDefinition,
  HarnessAdapterObject,
  OpenedHarnessAdapter,
  WorkingDirectoryPath,
} from "./contracts";
import type {
  AbortInput,
  AdapterOptionsFor,
  AdapterSessionFor,
  CreateSessionInput,
  CreatedSessionFromInput,
  DeleteSessionInput,
  GetSessionInput,
  ListSessionsInput,
  PromptInput,
  ResumeSessionInput,
  HarnessAdapterDefinitions,
} from "./types";

function normalizeAdapterOptions<TAdapterOptions extends HarnessAdapterObject>(
  adapterOptions: TAdapterOptions | undefined,
): TAdapterOptions {
  return (adapterOptions ?? {}) as TAdapterOptions;
}

function createStubCause(operation: string): Error {
  return new Error(`${operation} facade behavior is not implemented yet`);
}

async function createWorkingDirectoryPath(
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

async function openHarnessAdapter<
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

async function createAdapterSession<
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

export function defineHarnessAdapter<
  THarnessId extends string,
  TAdapterOptions extends HarnessAdapterObject = Record<never, never>,
  TAdapterSession extends HarnessAdapterObject = Record<never, never>,
>(
  adapter: HarnessAdapterDefinition<THarnessId, TAdapterOptions, TAdapterSession>,
): HarnessAdapterDefinition<THarnessId, TAdapterOptions, TAdapterSession> {
  return adapter;
}

/**
 * Creates a unified harness facade over one or more concrete adapters.
 *
 * The returned object lazily opens adapter runtimes on first use and validates
 * the requested working directory once before delegating to the selected adapter.
 */
export function createHarness<const TAdapters extends HarnessAdapterDefinitions<TAdapters>>(
  options: CreateHarnessOptions<TAdapters>,
): Harness<TAdapters> {
  const now = options.now ?? (() => new Date());
  const harnessIds = Object.freeze(
    Object.keys(options.adapters) as Extract<keyof TAdapters, string>[],
  );
  const openedRuntimes = new Map<
    string,
    OpenedHarnessAdapter<string, HarnessAdapterObject, HarnessAdapterObject>
  >();

  async function getRuntime<THarnessId extends keyof TAdapters>(
    harnessId: THarnessId,
    signal?: AbortSignal,
  ): Promise<
    Result<
      OpenedHarnessAdapter<
        Extract<THarnessId, string>,
        AdapterOptionsFor<TAdapters, THarnessId>,
        AdapterSessionFor<TAdapters, THarnessId>
      >,
      UnknownHarnessError | HarnessAdapterOpenError
    >
  > {
    const key = harnessId as string;
    const existing = openedRuntimes.get(key);
    if (existing) {
      return Result.ok(
        existing as OpenedHarnessAdapter<
          Extract<THarnessId, string>,
          AdapterOptionsFor<TAdapters, THarnessId>,
          AdapterSessionFor<TAdapters, THarnessId>
        >,
      );
    }

    const adapter = options.adapters[harnessId];
    if (!adapter) {
      return Result.err(
        new UnknownHarnessError({
          harnessId: key,
          availableHarnessIds: harnessIds,
        }),
      );
    }

    const selectedAdapter = adapter as HarnessAdapterDefinition<
      Extract<THarnessId, string>,
      AdapterOptionsFor<TAdapters, THarnessId>,
      AdapterSessionFor<TAdapters, THarnessId>
    >;

    return Result.gen(async function* () {
      const runtime = yield* Result.await(
        openHarnessAdapter({
          adapter: selectedAdapter,
          harnessId: key,
          signal,
        }),
      );

      openedRuntimes.set(
        key,
        runtime as OpenedHarnessAdapter<string, HarnessAdapterObject, HarnessAdapterObject>,
      );

      return Result.ok(
        runtime as OpenedHarnessAdapter<
          Extract<THarnessId, string>,
          AdapterOptionsFor<TAdapters, THarnessId>,
          AdapterSessionFor<TAdapters, THarnessId>
        >,
      );
    });
  }

  return {
    harnessIds,

    async createSession<TInput extends CreateSessionInput<TAdapters>>(input: TInput) {
      return Result.gen(async function* () {
        const cwd = yield* Result.await(createWorkingDirectoryPath(input.cwd));
        const runtime = yield* Result.await(getRuntime(input.harnessId, input.signal));
        const created = yield* Result.await(
          createAdapterSession({
            runtime,
            harnessId: input.harnessId,
            input: {
              cwd,
              title: input.title,
              adapterOptions: normalizeAdapterOptions(
                "adapterOptions" in input
                  ? (input.adapterOptions as AdapterOptionsFor<TAdapters, TInput["harnessId"]>)
                  : undefined,
              ),
              signal: input.signal,
            },
          }),
        );

        return Result.ok({
          ref: {
            harnessId: input.harnessId,
            sessionId: created.sessionId,
          },
          cwd,
          title: input.title,
          createdAt: now().toISOString(),
          adapterData: created.adapterData,
        } as CreatedSessionFromInput<TAdapters, TInput>);
      });
    },

    async resumeSession<TInput extends ResumeSessionInput<TAdapters>>(input: TInput) {
      return Result.gen(async function* () {
        yield* Result.await(getRuntime(input.harnessId, input.signal));
        return Result.err(
          new HarnessAdapterResumeSessionError({
            harnessId: input.harnessId,
            cause: createStubCause("resumeSession"),
          }),
        );
      });
    },

    async listSessions<TInput extends ListSessionsInput<TAdapters>>(input: TInput) {
      return Result.gen(async function* () {
        yield* Result.await(getRuntime(input.harnessId, input.signal));
        return Result.err(
          new HarnessAdapterListSessionsError({
            harnessId: input.harnessId,
            cause: createStubCause("listSessions"),
          }),
        );
      });
    },

    async getSession<TInput extends GetSessionInput<TAdapters>>(input: TInput) {
      return Result.gen(async function* () {
        yield* Result.await(getRuntime(input.ref.harnessId, input.signal));
        return Result.err(
          new UnknownSessionError({
            harnessId: input.ref.harnessId,
            sessionId: input.ref.sessionId,
          }),
        );
      });
    },

    async prompt<TInput extends PromptInput<TAdapters>>(input: TInput) {
      return Result.gen(async function* () {
        yield* Result.await(getRuntime(input.ref.harnessId, input.signal));
        return Result.err(
          new UnknownSessionError({
            harnessId: input.ref.harnessId,
            sessionId: input.ref.sessionId,
          }),
        );
      });
    },

    async deleteSession<TInput extends DeleteSessionInput<TAdapters>>(input: TInput) {
      return Result.gen(async function* () {
        yield* Result.await(getRuntime(input.ref.harnessId, input.signal));
        return Result.err(
          new UnknownSessionError({
            harnessId: input.ref.harnessId,
            sessionId: input.ref.sessionId,
          }),
        );
      });
    },

    async abort<TInput extends AbortInput<TAdapters>>(input: TInput) {
      return Result.gen(async function* () {
        yield* Result.await(getRuntime(input.ref.harnessId, input.signal));
        return Result.err(
          new UnknownSessionError({
            harnessId: input.ref.harnessId,
            sessionId: input.ref.sessionId,
          }),
        );
      });
    },

    async close() {
      const closeResults = await Promise.all(
        [...openedRuntimes.entries()].map(async ([harnessId, runtime]) => {
          return Result.tryPromise({
            try: async () => {
              await runtime.close();
              openedRuntimes.delete(harnessId);
            },
            catch: (cause) => ({ harnessId, cause }),
          });
        }),
      );
      const [, failures] = Result.partition(closeResults);

      return failures.length === 0 ? Result.ok() : Result.err(new HarnessCloseError({ failures }));
    },
  };
}
