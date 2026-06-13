import type { HarnessAdapterPromptInput, HarnessAdapterPromptResult } from "@xmux/harness-core";
import { Result, type Result as ResultType } from "better-result";
import {
  PiModelRequestError,
  PiModelSelectionError,
  PiPromptContentError,
  PiSessionRequestError,
  PiSessionResponseError,
} from "../errors";
import type { PiRuntime, PiSessionHandle } from "../runtime";
import type { PiCreateOptions } from "../types";
import { resolvePiModel, toPiThinkingLevel } from "./models";
import { resumeSession } from "./resume-session";
import { resolvePiSession, type PiSessionHandlerError } from "./utils";
import {
  createPiPromptEventState,
  mapPiSessionEvent,
  toPiPromptContent,
  type PiPromptContent,
  type PiPromptEvent,
} from "../prompt";

type PiPromptHandlerError =
  | PiPromptContentError
  | PiModelRequestError
  | PiModelSelectionError
  | PiSessionHandlerError
  | PiSessionRequestError
  | PiSessionResponseError;

type PromptQueue = {
  readonly push: (event: PiPromptEvent) => void;
  readonly fail: (error: unknown) => void;
  readonly end: () => void;
  readonly events: AsyncIterable<PiPromptEvent>;
  readonly isDone: () => boolean;
};

function isTerminalRunEvent(event: PiPromptEvent): boolean {
  return (
    event.type === "run" &&
    (event.phase === "completed" || event.phase === "failed" || event.phase === "aborted")
  );
}

function createPromptQueue(): PromptQueue {
  const events: PiPromptEvent[] = [];
  let done = false;
  let failure: unknown;
  let notify: (() => void) | undefined;

  const wake = () => {
    notify?.();
    notify = undefined;
  };

  return {
    push(event) {
      if (done) return;
      events.push(event);
      if (isTerminalRunEvent(event)) done = true;
      wake();
    },
    fail(error) {
      if (done) return;
      failure = error;
      done = true;
      wake();
    },
    end() {
      if (done) return;
      done = true;
      wake();
    },
    isDone() {
      return done;
    },
    events: {
      async *[Symbol.asyncIterator]() {
        while (true) {
          if (events.length > 0) {
            const event = events.shift();
            if (event) yield event;
            continue;
          }

          if (done) {
            if (failure !== undefined) throw failure;
            return;
          }

          await new Promise<void>((resolve) => {
            notify = resolve;
          });
        }
      },
    },
  };
}

async function ensureLiveSession(args: {
  readonly runtime: PiRuntime;
  readonly input: HarnessAdapterPromptInput<"pi", PiCreateOptions>;
}): Promise<
  ResultType<
    PiSessionHandle,
    PiSessionHandlerError | PiSessionResponseError | PiModelRequestError | PiModelSelectionError
  >
> {
  return Result.gen(async function* () {
    const resolved = yield* Result.await(
      resolvePiSession({
        runtime: args.runtime,
        operation: "prompt",
        sessionId: args.input.ref.sessionId,
        cwd: args.input.cwd,
        adapterOptions: args.input.adapterOptions,
      }),
    );

    if (resolved.handle) return Result.ok(resolved.handle);

    yield* Result.await(
      resumeSession(args.runtime, {
        sessionId: args.input.ref.sessionId,
        cwd: args.input.cwd,
        adapterOptions: args.input.adapterOptions,
        signal: args.input.signal,
      }),
    );

    const handle = args.runtime.sessions.get(args.input.ref.sessionId);
    return handle
      ? Result.ok(handle)
      : Result.err(
          new PiSessionResponseError({
            operation: "prompt",
            reason: "session resumed but no live handle was registered",
            detail: args.input.ref.sessionId,
          }),
        );
  });
}

async function applyPromptSelections(args: {
  readonly handle: PiSessionHandle;
  readonly input: HarnessAdapterPromptInput<"pi", PiCreateOptions>;
}): Promise<ResultType<void, PiModelSelectionError | PiSessionRequestError>> {
  return Result.gen(async function* () {
    if (args.input.model) {
      const model = yield* resolvePiModel({
        registry: args.handle.session.modelRegistry,
        model: args.input.model,
      });
      yield* Result.await(
        Result.tryPromise({
          try: () => args.handle.session.setModel(model),
          catch: (cause) => new PiSessionRequestError({ operation: "prompt.setModel", cause }),
        }),
      );
    }

    if (args.input.thinking) {
      const level = yield* toPiThinkingLevel({ level: args.input.thinking });
      yield* Result.try({
        try: () => args.handle.session.setThinkingLevel(level),
        catch: (cause) => new PiSessionRequestError({ operation: "prompt.setThinking", cause }),
      });
    }

    return Result.ok();
  });
}

function createPiPromptStream(args: {
  readonly handle: PiSessionHandle;
  readonly input: HarnessAdapterPromptInput<"pi", PiCreateOptions>;
  readonly content: PiPromptContent;
}): HarnessAdapterPromptResult<"pi"> {
  return {
    async *[Symbol.asyncIterator]() {
      const queue = createPromptQueue();
      const state = createPiPromptEventState();
      let settled = false;
      const abort = () => {
        void args.handle.session.abort();
      };

      const unsubscribe = args.handle.session.subscribe((event) => {
        for (const mapped of mapPiSessionEvent({ event, ref: args.input.ref, state })) {
          queue.push(mapped);
        }
      });

      args.input.signal?.addEventListener("abort", abort, { once: true });

      const run = (async () => {
        try {
          const selection = await applyPromptSelections({ handle: args.handle, input: args.input });
          if (selection.isErr()) throw selection.error;

          await args.handle.session.prompt(args.content.text, {
            images: args.content.images,
            streamingBehavior: args.handle.session.isStreaming ? "followUp" : undefined,
          });
        } catch (error) {
          queue.push(
            args.input.signal?.aborted
              ? {
                  type: "run",
                  phase: "aborted",
                  ref: args.input.ref,
                  reason: "aborted",
                  error: args.input.signal.reason ?? error,
                }
              : {
                  type: "run",
                  phase: "failed",
                  ref: args.input.ref,
                  reason: "error",
                  error,
                },
          );
        } finally {
          settled = true;
          queue.end();
        }
      })();

      try {
        yield* queue.events;
        await run;
      } finally {
        unsubscribe();
        args.input.signal?.removeEventListener("abort", abort);
        if (!settled && args.input.signal?.aborted) abort();
      }
    },
  };
}

export async function prompt(
  runtime: PiRuntime,
  input: HarnessAdapterPromptInput<"pi", PiCreateOptions>,
): Promise<ResultType<HarnessAdapterPromptResult<"pi">, PiPromptHandlerError>> {
  return Result.gen(async function* () {
    const content = yield* toPiPromptContent(input.content);
    const handle = yield* Result.await(ensureLiveSession({ runtime, input }));

    return Result.ok(createPiPromptStream({ handle, input, content }));
  });
}
