import type {
  HarnessAdapterPromptInput,
  HarnessAdapterPromptResult,
  HarnessThinkingLevel,
} from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import {
  OpenCodeModelSelectionError,
  OpenCodeSessionRequestError,
  OpenCodeSessionResponseError,
} from "../errors";
import type { OpenCodeRuntime } from "../runtime";
import { toPromptParts } from "./content";
import { createStreamEndedError, isAbortError, normalizeOpenCodeStreamEvent } from "./event-utils";
import { mapOpenCodeEvent } from "./event-mapper";
import { createPromptStreamState } from "./state";
import type { OpenCodePromptEvent, OpenCodePromptPart, SelectedOpenCodeModel } from "./types";
import type { OpenCodeCreateOptions } from "../types";
import { normalizeOpenCodeModelRef } from "../handlers/models";
import { applyThinkingToModel, getEffectiveThinking } from "../handlers/thinking";
import { describeResponseError } from "../handlers/utils";

function createResponseError(args: { readonly status: number; readonly error: unknown }) {
  return new OpenCodeSessionResponseError({
    status: args.status,
    detail: describeResponseError(args.error),
    reason: "OpenCode session prompt failed",
  });
}

async function sendPromptAsync(
  runtime: OpenCodeRuntime,
  input: HarnessAdapterPromptInput<"opencode", OpenCodeCreateOptions>,
  parts: readonly OpenCodePromptPart[],
  model: SelectedOpenCodeModel | undefined,
) {
  return Result.tryPromise({
    try: () =>
      runtime.client.session.promptAsync(
        {
          sessionID: input.ref.sessionId,
          directory: input.cwd,
          workspace: input.adapterOptions.workspace,
          model: model ? { providerID: model.providerID, modelID: model.modelID } : undefined,
          variant: model?.variant,
          parts: [...parts],
        },
        { signal: input.signal },
      ),
    catch: (cause) => new OpenCodeSessionRequestError({ cause }),
  });
}

function createPromptEventStream(args: {
  readonly runtime: OpenCodeRuntime;
  readonly input: HarnessAdapterPromptInput<"opencode", OpenCodeCreateOptions>;
  readonly parts: readonly OpenCodePromptPart[];
  readonly model?: SelectedOpenCodeModel;
  readonly thinking?: HarnessThinkingLevel;
}): HarnessAdapterPromptResult<"opencode"> {
  async function* eventStream(): AsyncIterable<OpenCodePromptEvent> {
    const state = createPromptStreamState();
    state.selectedThinking = args.thinking;
    const streamAbort = new AbortController();
    let promptAccepted = false;
    const abortStream = () => {
      streamAbort.abort(args.input.signal?.reason);
      if (!promptAccepted) return;

      void args.runtime.client.session
        .abort({
          sessionID: args.input.ref.sessionId,
          workspace: args.input.adapterOptions.workspace,
        })
        .catch(() => undefined);
    };
    args.input.signal?.addEventListener("abort", abortStream, { once: true });

    try {
      if (args.input.signal?.aborted) {
        yield {
          type: "run",
          phase: "aborted",
          ref: args.input.ref,
          reason: "aborted",
          error: args.input.signal.reason,
        };
        return;
      }

      const subscribed = await args.runtime.client.global.event({
        signal: streamAbort.signal,
        sseMaxRetryAttempts: 1,
      });
      const iterator = subscribed.stream[Symbol.asyncIterator]();
      let pendingEvent = iterator.next();

      yield {
        type: "run",
        phase: "started",
        ref: args.input.ref,
      };

      const prompted = await sendPromptAsync(args.runtime, args.input, args.parts, args.model);
      if (prompted.isErr()) {
        streamAbort.abort(prompted.error);
        yield {
          type: "run",
          phase: "failed",
          ref: args.input.ref,
          reason: "error",
          error: prompted.error,
        };
        return;
      }

      const status = prompted.value.response?.status ?? 0;
      if (prompted.value.error) {
        const error = createResponseError({ status, error: prompted.value.error });
        streamAbort.abort(error);
        yield {
          type: "run",
          phase: "failed",
          ref: args.input.ref,
          reason: "error",
          error,
        };
        return;
      }

      promptAccepted = true;

      while (!streamAbort.signal.aborted) {
        const next = await pendingEvent;
        if (next.done) break;

        pendingEvent = iterator.next();

        const event = normalizeOpenCodeStreamEvent(next.value);
        if (!event) {
          continue;
        }

        for (const promptEvent of mapOpenCodeEvent({
          runtime: args.runtime,
          event,
          ref: args.input.ref,
          state,
        })) {
          yield promptEvent;
        }

        if (state.terminalRun) {
          streamAbort.abort();
          await iterator.return?.(undefined);
          return;
        }
      }

      if (args.input.signal?.aborted) {
        yield {
          type: "run",
          phase: "aborted",
          ref: args.input.ref,
          reason: "aborted",
          error: args.input.signal.reason,
        };
        return;
      }

      if (!state.terminalRun) {
        if (state.completedRun) {
          yield {
            type: "run",
            phase: "completed",
            ref: args.input.ref,
            reason: state.completedRun.reason,
            usage: state.completedRun.usage,
            cost: state.completedRun.cost,
          };
          return;
        }

        yield {
          type: "run",
          phase: "failed",
          ref: args.input.ref,
          reason: "error",
          error: createStreamEndedError(),
        };
      }
    } catch (error) {
      if (isAbortError(error) || args.input.signal?.aborted) {
        yield {
          type: "run",
          phase: "aborted",
          ref: args.input.ref,
          reason: "aborted",
          error,
        };
        return;
      }

      yield {
        type: "run",
        phase: "failed",
        ref: args.input.ref,
        reason: "error",
        error,
      };
    } finally {
      args.input.signal?.removeEventListener("abort", abortStream);
      streamAbort.abort();
    }
  }

  return eventStream();
}

export async function prompt(
  runtime: OpenCodeRuntime,
  input: HarnessAdapterPromptInput<"opencode", OpenCodeCreateOptions>,
): Promise<
  ResultType<
    HarnessAdapterPromptResult<"opencode">,
    OpenCodeModelSelectionError | OpenCodeSessionRequestError | OpenCodeSessionResponseError
  >
> {
  return Result.gen(async function* () {
    const selectedThinking =
      input.thinking ??
      runtime.sessionThinking?.get(input.ref.sessionId) ??
      runtime.defaultThinking;
    const selectedModelValue = yield* applyThinkingToModel({
      runtime,
      model: input.model ?? runtime.sessionModels.get(input.ref.sessionId) ?? runtime.defaultModel,
      level: selectedThinking,
    });

    const model = selectedModelValue
      ? yield* normalizeOpenCodeModelRef(selectedModelValue)
      : undefined;
    if (selectedModelValue) runtime.sessionModels.set(input.ref.sessionId, selectedModelValue);
    if (input.thinking) runtime.sessionThinking?.set(input.ref.sessionId, input.thinking);
    const effectiveThinking =
      selectedThinking ??
      (runtime.sessionThinking
        ? getEffectiveThinking({
            runtime,
            target: { type: "session", ref: input.ref },
          }).level
        : undefined);

    const parts = toPromptParts(input.content);
    return Result.ok(
      createPromptEventStream({ runtime, input, parts, model, thinking: effectiveThinking }),
    );
  });
}
