import { Result } from "better-result";
import { HarnessAdapterOpenError, HarnessCloseError, UnknownHarnessError } from "./errors";
import type {
  CreateHarnessOptions,
  Harness,
  HarnessAdapterDefinition,
  HarnessAdapterObject,
  OpenedHarnessAdapter,
} from "./contracts";
import type {
  AbortInput,
  AdapterModelFor,
  AdapterOptionsFor,
  AdapterSessionFor,
  CreateSessionInput,
  DeleteSessionInput,
  GetModelInput,
  GetSessionInput,
  GetThinkingInput,
  HarnessAdapterDefinitions,
  ListModelsInput,
  ListSessionsInput,
  PromptInput,
  ResumeSessionInput,
  SetModelInput,
  SetThinkingInput,
} from "./types";
import { handleGetModel } from "./handlers/model/get";
import { handleListModels } from "./handlers/model/list";
import { handleSetModel } from "./handlers/model/set";
import { handleGetThinking } from "./handlers/thinking/get";
import { handleSetThinking } from "./handlers/thinking/set";
import { handleAbort } from "./handlers/session/abort";
import { handleCreateSession } from "./handlers/session/create";
import { handleDeleteSession } from "./handlers/session/delete";
import { handleGetSession } from "./handlers/session/get";
import { handleListSessions } from "./handlers/session/list";
import { handlePrompt } from "./handlers/session/prompt";
import { handleResumeSession } from "./handlers/session/resume";
import { openHarnessAdapter } from "./handlers/utils";

export function defineHarnessAdapter<
  THarnessId extends string,
  TAdapterOptions extends HarnessAdapterObject = Record<never, never>,
  TAdapterSession extends HarnessAdapterObject = Record<never, never>,
  TAdapterModel extends HarnessAdapterObject = HarnessAdapterObject,
>(
  adapter: HarnessAdapterDefinition<THarnessId, TAdapterOptions, TAdapterSession, TAdapterModel>,
): HarnessAdapterDefinition<THarnessId, TAdapterOptions, TAdapterSession, TAdapterModel> {
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
    OpenedHarnessAdapter<string, HarnessAdapterObject, HarnessAdapterObject, HarnessAdapterObject>
  >();

  async function getRuntime<THarnessId extends keyof TAdapters>(
    harnessId: THarnessId,
    signal?: AbortSignal,
  ): Promise<
    Result<
      OpenedHarnessAdapter<
        Extract<THarnessId, string>,
        AdapterOptionsFor<TAdapters, THarnessId>,
        AdapterSessionFor<TAdapters, THarnessId>,
        AdapterModelFor<TAdapters, THarnessId>
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
          AdapterSessionFor<TAdapters, THarnessId>,
          AdapterModelFor<TAdapters, THarnessId>
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
      AdapterSessionFor<TAdapters, THarnessId>,
      AdapterModelFor<TAdapters, THarnessId>
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
        runtime as OpenedHarnessAdapter<
          string,
          HarnessAdapterObject,
          HarnessAdapterObject,
          HarnessAdapterObject
        >,
      );

      return Result.ok(
        runtime as OpenedHarnessAdapter<
          Extract<THarnessId, string>,
          AdapterOptionsFor<TAdapters, THarnessId>,
          AdapterSessionFor<TAdapters, THarnessId>,
          AdapterModelFor<TAdapters, THarnessId>
        >,
      );
    });
  }

  return {
    harnessIds,

    async createSession<TInput extends CreateSessionInput<TAdapters>>(input: TInput) {
      return handleCreateSession({ input, getRuntime, now });
    },

    async resumeSession<TInput extends ResumeSessionInput<TAdapters>>(input: TInput) {
      return handleResumeSession({ input, getRuntime });
    },

    async listSessions<TInput extends ListSessionsInput<TAdapters>>(input: TInput) {
      return handleListSessions({ input, getRuntime });
    },

    async listModels<TInput extends ListModelsInput<TAdapters>>(input: TInput) {
      return handleListModels({ input, getRuntime });
    },

    async getModel<TInput extends GetModelInput<TAdapters>>(input: TInput) {
      return handleGetModel({ input, getRuntime });
    },

    async setModel<TInput extends SetModelInput<TAdapters>>(input: TInput) {
      return handleSetModel({ input, getRuntime });
    },

    async getThinking<TInput extends GetThinkingInput<TAdapters>>(input: TInput) {
      return handleGetThinking({ input, getRuntime });
    },

    async setThinking<TInput extends SetThinkingInput<TAdapters>>(input: TInput) {
      return handleSetThinking({ input, getRuntime });
    },

    async getSession<TInput extends GetSessionInput<TAdapters>>(input: TInput) {
      return handleGetSession({ input, getRuntime });
    },

    async prompt<TInput extends PromptInput<TAdapters>>(input: TInput) {
      return handlePrompt({ input, getRuntime });
    },

    async deleteSession<TInput extends DeleteSessionInput<TAdapters>>(input: TInput) {
      return handleDeleteSession({ input, getRuntime });
    },

    async abort<TInput extends AbortInput<TAdapters>>(input: TInput) {
      return handleAbort({ input, getRuntime });
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
