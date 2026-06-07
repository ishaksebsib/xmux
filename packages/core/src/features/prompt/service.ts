import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type {
  AdapterOptionsFor,
  HarnessAdapterDefinitions,
  HarnessPromptEvent,
  PromptError,
  PromptInput,
  PromptInputFor,
  SessionRef,
} from "@xmux/harness-core";
import { Result } from "better-result";
import type { HandlerContext } from "../../ctx";
import type { StoreError } from "../../errors";
import type { ChatThreadRef, SessionRecord } from "../../store";
import { NoActiveSessionError, SessionClosedError, SessionRecordMissingError } from "../errors";
import { PromptAlreadyRunningError } from "./errors";
import type { ActivePromptRun } from "./run-registry";

export type PromptSessionForThreadError =
  | StoreError
  | NoActiveSessionError
  | SessionRecordMissingError
  | SessionClosedError
  | PromptAlreadyRunningError
  | PromptError;

export interface PromptSessionForThreadInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
  readonly text: string;
}

export interface PromptSessionForThreadOutput {
  readonly session: SessionRecord;
  readonly events: AsyncIterable<HarnessPromptEvent>;
  cancel(reason?: unknown): void;
  release(): void;
}

/** Prompts the active session bound to a chat thread. */
export async function promptSessionForThread<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: PromptSessionForThreadInput<TAdapters, TChats>,
): Promise<Result<PromptSessionForThreadOutput, PromptSessionForThreadError>> {
  return Result.gen(async function* () {
    const session = yield* Result.await(
      getPromptSessionForThread({ ctx: input.ctx, thread: input.thread }),
    );

    const run = yield* input.ctx.app.services.promptRuns.tryStart({
      sessionRef: session.ref,
      requestId: input.ctx.requestId,
      now: input.ctx.app.services.now().toISOString(),
    });

    const signal = composeAbortSignals([input.ctx.signal, run.signal]);
    const promptInput = createHarnessPromptInput<TAdapters, keyof TAdapters>({
      ref: toConfiguredSessionRef<TAdapters>(session.ref),
      cwd: session.cwd,
      text: input.text,
      signal,
    });
    const promptedResult = await input.ctx.app.harness.prompt(
      promptInput as PromptInput<TAdapters>,
    );

    if (promptedResult.isErr()) {
      run.release();
      return Result.err(promptedResult.error);
    }

    const prompted = promptedResult.value;

    return Result.ok({
      session,
      events: observePromptRunEvents({ events: prompted, run }),
      cancel(reason?: unknown) {
        run.markCancelling();
        if (!run.signal.aborted) {
          run.controller.abort(reason);
        }
      },
      release() {
        run.release();
      },
    });
  });
}

export interface GetPromptSessionForThreadInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
}

/** Returns the open session currently attached to a chat thread. */
export async function getPromptSessionForThread<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: GetPromptSessionForThreadInput<TAdapters, TChats>,
): Promise<
  Result<
    SessionRecord,
    StoreError | NoActiveSessionError | SessionRecordMissingError | SessionClosedError
  >
> {
  return Result.gen(async function* () {
    const binding = yield* Result.await(input.ctx.app.store.threadBindings.get(input.thread));

    if (!binding) {
      return Result.err(new NoActiveSessionError({ thread: input.thread }));
    }

    const session = yield* Result.await(input.ctx.app.store.sessions.get(binding.sessionRef));

    if (!session) {
      return Result.err(new SessionRecordMissingError({ sessionRef: binding.sessionRef }));
    }

    if (session.status !== "open") {
      return Result.err(new SessionClosedError({ sessionRef: session.ref }));
    }

    return Result.ok(session);
  });
}

export function composeAbortSignals(signals: readonly AbortSignal[]): AbortSignal {
  const controller = new AbortController();

  if (signals.length === 0) {
    return controller.signal;
  }

  const listeners: (() => void)[] = [];
  const abort = (signal: AbortSignal) => {
    if (!controller.signal.aborted) {
      controller.abort(signal.reason);
    }
  };

  for (const signal of signals) {
    if (signal.aborted) {
      abort(signal);
      return controller.signal;
    }
  }

  for (const signal of signals) {
    const onAbort = () => abort(signal);
    signal.addEventListener("abort", onAbort, { once: true });
    listeners.push(() => signal.removeEventListener("abort", onAbort));
  }

  controller.signal.addEventListener(
    "abort",
    () => {
      for (const cleanup of listeners) cleanup();
    },
    { once: true },
  );

  return controller.signal;
}

type ConfiguredHarnessId<TAdapters extends HarnessAdapterDefinitions<TAdapters>> = Extract<
  keyof TAdapters,
  string
>;

function toConfiguredSessionRef<TAdapters extends HarnessAdapterDefinitions<TAdapters>>(
  ref: SessionRecord["ref"],
): SessionRef<ConfiguredHarnessId<TAdapters>> {
  return {
    harnessId: ref.harnessId as ConfiguredHarnessId<TAdapters>,
    sessionId: ref.sessionId,
  };
}

function createHarnessPromptInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  THarnessId extends keyof TAdapters,
>(input: {
  readonly ref: SessionRef<Extract<THarnessId, string>>;
  readonly cwd: string;
  readonly text: string;
  readonly signal: AbortSignal;
}): PromptInputFor<TAdapters, THarnessId> {
  return {
    ref: input.ref,
    cwd: input.cwd,
    content: [{ type: "text", text: input.text }] as const,
    adapterOptions: {} as AdapterOptionsFor<TAdapters, THarnessId>,
    signal: input.signal,
  };
}

async function* observePromptRunEvents(input: {
  readonly events: AsyncIterable<HarnessPromptEvent>;
  readonly run: ActivePromptRun;
}): AsyncIterable<HarnessPromptEvent> {
  try {
    for await (const event of input.events) {
      input.run.recordEvent(event);
      yield event;
    }
  } finally {
    input.run.release();
  }
}
