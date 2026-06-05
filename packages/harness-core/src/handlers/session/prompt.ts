import { Result } from "better-result";
import {
  HarnessAdapterPromptError,
  PromptStreamEndedWithoutTerminalEventError,
} from "../../errors";
import type { SessionRef } from "../../contracts";
import type { HarnessPromptEvent } from "../../events";
import type { HarnessAdapterDefinitions, PromptInput, PromptResultFromInput } from "../../types";
import type { HarnessRuntimeGetter } from "../utils";
import {
  adapterOptionsFromInput,
  createWorkingDirectoryPath,
  normalizePromptContent,
} from "../utils";

interface AbortedIteratorResult {
  readonly aborted: true;
}

function isRunStartedEvent(event: HarnessPromptEvent): boolean {
  return event.type === "run" && event.phase === "started";
}

function isTerminalRunEvent(event: HarnessPromptEvent): boolean {
  return (
    event.type === "run" &&
    (event.phase === "completed" || event.phase === "failed" || event.phase === "aborted")
  );
}

function createStartedEvent<THarnessId extends string>(
  ref: SessionRef<THarnessId>,
): HarnessPromptEvent<THarnessId> {
  return {
    type: "run",
    phase: "started",
    ref,
  };
}

function createAbortedEvent<THarnessId extends string>(args: {
  readonly ref: SessionRef<THarnessId>;
  readonly signal?: AbortSignal;
}): HarnessPromptEvent<THarnessId> {
  return {
    type: "run",
    phase: "aborted",
    ref: args.ref,
    reason: "aborted",
    error: args.signal?.reason,
  };
}

function createFailedEvent<THarnessId extends string>(args: {
  readonly ref: SessionRef<THarnessId>;
  readonly error: unknown;
}): HarnessPromptEvent<THarnessId> {
  return {
    type: "run",
    phase: "failed",
    ref: args.ref,
    reason: "error",
    error: args.error,
  };
}

async function nextWithAbort<TValue>(args: {
  readonly iterator: AsyncIterator<TValue>;
  readonly signal?: AbortSignal;
}): Promise<IteratorResult<TValue> | AbortedIteratorResult> {
  if (!args.signal) {
    return args.iterator.next();
  }

  const signal = args.signal;

  if (signal.aborted) {
    return { aborted: true };
  }

  return new Promise<IteratorResult<TValue> | AbortedIteratorResult>((resolve, reject) => {
    const onAbort = () => {
      resolve({ aborted: true });
    };

    signal.addEventListener("abort", onAbort, { once: true });
    args.iterator.next().then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function isAbortedIteratorResult<TValue>(
  result: IteratorResult<TValue> | AbortedIteratorResult,
): result is AbortedIteratorResult {
  return "aborted" in result;
}

async function closeIterator<TValue>(iterator: AsyncIterator<TValue>): Promise<void> {
  if (!iterator.return) return;

  try {
    await iterator.return();
  } catch {
    // Ignore close failures after the supervisor has already produced a terminal event.
  }
}

export async function* supervisePromptStream<THarnessId extends string>(args: {
  readonly ref: SessionRef<THarnessId>;
  readonly events: AsyncIterable<HarnessPromptEvent<THarnessId>>;
  readonly signal?: AbortSignal;
}): AsyncIterable<HarnessPromptEvent<THarnessId>> {
  let started = false;
  let terminal = false;
  let iteratorDone = false;
  const iterator = args.events[Symbol.asyncIterator]();

  if (args.signal?.aborted) {
    started = true;
    terminal = true;
    void closeIterator(iterator);
    yield createStartedEvent(args.ref);
    yield createAbortedEvent({ ref: args.ref, signal: args.signal });
    return;
  }

  try {
    while (true) {
      const next = await nextWithAbort({ iterator, signal: args.signal });

      if (isAbortedIteratorResult(next)) {
        void closeIterator(iterator);

        if (!started) {
          started = true;
          yield createStartedEvent(args.ref);
        }

        if (!terminal) {
          terminal = true;
          yield createAbortedEvent({ ref: args.ref, signal: args.signal });
        }

        return;
      }

      if (next.done) {
        iteratorDone = true;
        break;
      }

      const event = next.value;

      if (isRunStartedEvent(event)) {
        if (started) continue;

        started = true;
        yield event;
        continue;
      }

      if (!started) {
        started = true;
        yield createStartedEvent(args.ref);
      }

      if (isTerminalRunEvent(event)) {
        if (!terminal) {
          terminal = true;
          yield event;
        }

        void closeIterator(iterator);
        return;
      }

      yield event;
    }
  } catch (error) {
    if (!iteratorDone) void closeIterator(iterator);

    if (!started) {
      started = true;
      yield createStartedEvent(args.ref);
    }

    if (!terminal) {
      terminal = true;
      yield args.signal?.aborted
        ? createAbortedEvent({ ref: args.ref, signal: args.signal })
        : createFailedEvent({ ref: args.ref, error });
    }

    return;
  }

  if (!terminal) {
    if (!started) {
      started = true;
      yield createStartedEvent(args.ref);
    }

    terminal = true;
    yield args.signal?.aborted
      ? createAbortedEvent({ ref: args.ref, signal: args.signal })
      : createFailedEvent({
          ref: args.ref,
          error: new PromptStreamEndedWithoutTerminalEventError({
            harnessId: args.ref.harnessId,
            sessionId: args.ref.sessionId,
          }),
        });
  }
}

export async function handlePrompt<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TInput extends PromptInput<TAdapters>,
>(args: { readonly input: TInput; readonly getRuntime: HarnessRuntimeGetter<TAdapters> }) {
  return Result.gen(async function* () {
    const cwd = yield* Result.await(createWorkingDirectoryPath(args.input.cwd));
    const runtime = yield* Result.await(
      args.getRuntime(args.input.ref.harnessId, args.input.signal),
    );
    const outer = await Result.tryPromise({
      try: async () =>
        runtime.prompt({
          ref: args.input.ref,
          cwd,
          content: normalizePromptContent(args.input.content),
          model: args.input.model,
          thinking: args.input.thinking,
          adapterOptions: adapterOptionsFromInput<TAdapters, TInput["ref"]["harnessId"]>(
            args.input,
          ),
          signal: args.input.signal,
        }),
      catch: (cause) =>
        new HarnessAdapterPromptError({ harnessId: args.input.ref.harnessId, cause }),
    });

    const adapterResult = yield* Result.andThen(outer, (adapterResult) =>
      Result.mapError(
        adapterResult,
        (cause) => new HarnessAdapterPromptError({ harnessId: args.input.ref.harnessId, cause }),
      ),
    );

    return Result.ok(
      supervisePromptStream({
        ref: args.input.ref,
        events: adapterResult,
        signal: args.input.signal,
      }) as PromptResultFromInput<TAdapters, TInput>,
    );
  });
}
