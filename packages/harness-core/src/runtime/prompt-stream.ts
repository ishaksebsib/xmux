import type { SessionRef } from "../contracts";
import { PromptStreamEndedWithoutTerminalEventError } from "../errors";
import type { HarnessPromptEvent } from "../events";

interface AbortedIteratorResult<TValue> {
  readonly aborted: true;
  readonly pending?: Promise<IteratorResult<TValue>>;
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
}): Promise<IteratorResult<TValue> | AbortedIteratorResult<TValue>> {
  if (!args.signal) {
    return args.iterator.next();
  }

  const signal = args.signal;

  if (signal.aborted) {
    return { aborted: true };
  }

  const pending = args.iterator.next();

  return new Promise<IteratorResult<TValue> | AbortedIteratorResult<TValue>>((resolve, reject) => {
    const onAbort = () => {
      resolve({ aborted: true, pending });
    };

    signal.addEventListener("abort", onAbort, { once: true });
    pending.then(
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
  result: IteratorResult<TValue> | AbortedIteratorResult<TValue>,
): result is AbortedIteratorResult<TValue> {
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

function closeIteratorAfterPending<TValue>(args: {
  readonly iterator: AsyncIterator<TValue>;
  readonly pending?: Promise<IteratorResult<TValue>>;
}): void {
  if (!args.pending) {
    void closeIterator(args.iterator);
    return;
  }

  void args.pending.then(
    () => closeIterator(args.iterator),
    () => closeIterator(args.iterator),
  );
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
        closeIteratorAfterPending({ iterator, pending: next.pending });

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
