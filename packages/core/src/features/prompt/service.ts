import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type {
  HarnessAdapterDefinitions,
  HarnessPromptEvent,
  PromptError,
  PromptInput,
} from "@xmux/harness-core";
import { Result } from "better-result";
import type { HandlerContext } from "../../ctx";
import type { StoreError } from "../../errors";
import type { ChatThreadRef, SessionRecord } from "../../store";
import {
  PromptAlreadyRunningError,
  PromptNoActiveSessionError,
  PromptSessionClosedError,
  PromptSessionRecordMissingError,
} from "./errors";
import type { ActivePromptRun } from "./run-registry";

export type PromptSessionForThreadError =
  | StoreError
  | PromptNoActiveSessionError
  | PromptSessionRecordMissingError
  | PromptSessionClosedError
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
  const session = await getPromptSessionForThread({ ctx: input.ctx, thread: input.thread });

  if (session.isErr()) {
    return Result.err(session.error);
  }

  const run = input.ctx.app.services.promptRuns.tryStart({
    sessionRef: session.value.ref,
    requestId: input.ctx.requestId,
    now: input.ctx.app.services.now().toISOString(),
  });

  if (run.isErr()) {
    return Result.err(run.error);
  }

  const signal = composeAbortSignals([input.ctx.signal, run.value.signal]);
  const prompted = await input.ctx.app.harness.prompt(
    createHarnessPromptInput({
      ref: session.value.ref,
      cwd: session.value.cwd,
      text: input.text,
      signal,
    }) as unknown as PromptInput<TAdapters>,
  );

  if (prompted.isErr()) {
    run.value.release();
    return Result.err(prompted.error);
  }

  return Result.ok({
    session: session.value,
    events: observePromptRunEvents({ events: prompted.value, run: run.value }),
    cancel(reason?: unknown) {
      run.value.markCancelling();
      if (!run.value.signal.aborted) {
        run.value.controller.abort(reason);
      }
    },
    release() {
      run.value.release();
    },
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
    | StoreError
    | PromptNoActiveSessionError
    | PromptSessionRecordMissingError
    | PromptSessionClosedError
  >
> {
  const binding = await input.ctx.app.store.threadBindings.get(input.thread);

  if (binding.isErr()) {
    return Result.err(binding.error);
  }

  if (!binding.value) {
    return Result.err(new PromptNoActiveSessionError({ thread: input.thread }));
  }

  const session = await input.ctx.app.store.sessions.get(binding.value.sessionRef);

  if (session.isErr()) {
    return Result.err(session.error);
  }

  if (!session.value) {
    return Result.err(
      new PromptSessionRecordMissingError({ sessionRef: binding.value.sessionRef }),
    );
  }

  if (session.value.status !== "open") {
    return Result.err(new PromptSessionClosedError({ sessionRef: session.value.ref }));
  }

  return Result.ok(session.value);
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

function createHarnessPromptInput(input: {
  readonly ref: SessionRecord["ref"];
  readonly cwd: string;
  readonly text: string;
  readonly signal: AbortSignal;
}) {
  return {
    ref: input.ref,
    cwd: input.cwd,
    content: [{ type: "text", text: input.text }] as const,
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
