import { Result } from "better-result";
import { HarnessAdapterOpenError, HarnessCloseError, UnknownHarnessError } from "./errors";
import { harnessLogEvents } from "./logger";
import { createHarnessLogScope, logHarnessResult, startHarnessLogTimer } from "./logger-utils";
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
  RespondInteractionInput,
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
import { handleRespondInteraction } from "./handlers/interaction/respond";
import { handlePrompt } from "./handlers/session/prompt";
import { handleResumeSession } from "./handlers/session/resume";
import { openHarnessAdapter } from "./handlers/utils";
import {
  safeStatusReason,
  type HarnessAdapterRuntimeState,
  type HarnessRuntimeStatusSnapshot,
} from "./status";

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
  const logger = createHarnessLogScope(options.logger, {
    component: "@xmux/harness-core",
    packageName: "@xmux/harness-core",
  });
  const harnessIds = Object.freeze(
    Object.keys(options.adapters) as Extract<keyof TAdapters, string>[],
  );
  const openedRuntimes = new Map<
    string,
    OpenedHarnessAdapter<string, HarnessAdapterObject, HarnessAdapterObject, HarnessAdapterObject>
  >();
  const adapterStatuses = new Map<
    string,
    { readonly state: HarnessAdapterRuntimeState; readonly reason?: string }
  >();
  for (const harnessId of harnessIds) {
    setAdapterStatus(harnessId, "configured_lazy");
  }
  const openingRuntimes = new Map<
    string,
    Promise<
      Result<
        OpenedHarnessAdapter<
          string,
          HarnessAdapterObject,
          HarnessAdapterObject,
          HarnessAdapterObject
        >,
        HarnessAdapterOpenError
      >
    >
  >();

  function setAdapterStatus(
    harnessId: string,
    state: HarnessAdapterRuntimeState,
    reason?: string,
  ): void {
    adapterStatuses.set(harnessId, reason === undefined ? { state } : { state, reason });
  }

  function status(): HarnessRuntimeStatusSnapshot<Extract<keyof TAdapters, string>> {
    return {
      adapters: harnessIds.map((harnessId) => {
        const adapterStatus = adapterStatuses.get(harnessId) ?? { state: "configured_lazy" };
        return adapterStatus.reason === undefined
          ? { id: harnessId, state: adapterStatus.state }
          : { id: harnessId, state: adapterStatus.state, reason: adapterStatus.reason };
      }),
    };
  }

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

    const opening = openingRuntimes.get(key);
    if (opening) {
      return Result.map(
        await opening,
        (runtime) =>
          runtime as OpenedHarnessAdapter<
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

    setAdapterStatus(key, "opening");
    const openingRuntime = (async () => {
      const opened = await openHarnessAdapter({
        adapter: selectedAdapter,
        harnessId: key,
        signal,
        logger,
        adapterLogger: options.logger,
      });

      if (opened.isErr()) {
        setAdapterStatus(key, "failed", safeStatusReason(opened.error));
        return Result.err(opened.error);
      }

      const runtime = opened.value as OpenedHarnessAdapter<
        string,
        HarnessAdapterObject,
        HarnessAdapterObject,
        HarnessAdapterObject
      >;
      openedRuntimes.set(key, runtime);
      setAdapterStatus(key, "opened");

      return Result.ok(runtime);
    })();

    openingRuntimes.set(key, openingRuntime);
    const runtime = await openingRuntime;
    openingRuntimes.delete(key);

    return Result.map(
      runtime,
      (opened) =>
        opened as OpenedHarnessAdapter<
          Extract<THarnessId, string>,
          AdapterOptionsFor<TAdapters, THarnessId>,
          AdapterSessionFor<TAdapters, THarnessId>,
          AdapterModelFor<TAdapters, THarnessId>
        >,
    );
  }

  return {
    harnessIds,
    status,

    async createSession<TInput extends CreateSessionInput<TAdapters>>(input: TInput) {
      return handleCreateSession({ input, getRuntime, now, logger });
    },

    async resumeSession<TInput extends ResumeSessionInput<TAdapters>>(input: TInput) {
      return handleResumeSession({ input, getRuntime, logger });
    },

    async listSessions<TInput extends ListSessionsInput<TAdapters>>(input: TInput) {
      return handleListSessions({ input, getRuntime, logger });
    },

    async listModels<TInput extends ListModelsInput<TAdapters>>(input: TInput) {
      return handleListModels({ input, getRuntime, logger });
    },

    async getModel<TInput extends GetModelInput<TAdapters>>(input: TInput) {
      return handleGetModel({ input, getRuntime, logger });
    },

    async setModel<TInput extends SetModelInput<TAdapters>>(input: TInput) {
      return handleSetModel({ input, getRuntime, logger });
    },

    async getThinking<TInput extends GetThinkingInput<TAdapters>>(input: TInput) {
      return handleGetThinking({ input, getRuntime, logger });
    },

    async setThinking<TInput extends SetThinkingInput<TAdapters>>(input: TInput) {
      return handleSetThinking({ input, getRuntime, logger });
    },

    async getSession<TInput extends GetSessionInput<TAdapters>>(input: TInput) {
      return handleGetSession({ input, getRuntime, logger });
    },

    async prompt<TInput extends PromptInput<TAdapters>>(input: TInput) {
      return handlePrompt({ input, getRuntime, logger });
    },

    async deleteSession<TInput extends DeleteSessionInput<TAdapters>>(input: TInput) {
      return handleDeleteSession({ input, getRuntime, logger });
    },

    async abort<TInput extends AbortInput<TAdapters>>(input: TInput) {
      return handleAbort({ input, getRuntime, logger });
    },

    async respondInteraction<TInput extends RespondInteractionInput<TAdapters>>(input: TInput) {
      return handleRespondInteraction({ input, getRuntime, logger });
    },

    async close() {
      const startedAt = startHarnessLogTimer();
      const metadata = { operation: "close" } as const;
      logger.debug(harnessLogEvents.closeBegin, metadata);

      await Promise.all(openingRuntimes.values());

      const closeResults = await Promise.all(
        [...openedRuntimes.entries()].map(async ([harnessId, runtime]) => {
          const adapterStartedAt = startHarnessLogTimer();
          const adapterMetadata = { harnessId, operation: "closeAdapter" } as const;
          setAdapterStatus(harnessId, "closing");
          logger.debug(harnessLogEvents.adapterCloseBegin, adapterMetadata);

          const result = await Result.tryPromise({
            try: async () => {
              await runtime.close();
              openedRuntimes.delete(harnessId);
            },
            catch: (cause) => ({ harnessId, cause }),
          });

          if (result.isErr()) {
            setAdapterStatus(harnessId, "failed", safeStatusReason(result.error.cause));
          } else {
            setAdapterStatus(harnessId, "closed");
          }

          logHarnessResult({
            logger,
            result,
            startedAt: adapterStartedAt,
            metadata: adapterMetadata,
            successEvent: harnessLogEvents.adapterCloseSuccess,
            failureEvent: harnessLogEvents.adapterCloseFailure,
            failureLevel: "warn",
          });

          return result;
        }),
      );
      const [, failures] = Result.partition(closeResults);
      const result =
        failures.length === 0 ? Result.ok() : Result.err(new HarnessCloseError({ failures }));

      logHarnessResult({
        logger,
        result,
        startedAt,
        metadata,
        successEvent: harnessLogEvents.closeSuccess,
        failureEvent: harnessLogEvents.closeFailure,
        failureLevel: "warn",
      });

      return result;
    },
  };
}
