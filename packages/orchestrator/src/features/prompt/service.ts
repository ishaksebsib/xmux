import type { ChatAdapterDefinitions, ChatAttachment } from "@xmux/chat-core";
import type {
  AdapterOptionsFor,
  HarnessAdapterDefinitions,
  HarnessPromptEvent,
  HarnessPromptContent,
  PromptError,
  PromptInput,
  PromptInputFor,
  SessionRef,
} from "@xmux/harness-core";
import { Result } from "better-result";
import type { HandlerContext } from "../../ctx";
import type { ChatThreadRef, SessionRecord } from "../../store";
import { getActiveSessionForThread, type ActiveSessionError } from "../session";
import { materializePromptAttachments } from "./attachments";
import { PromptAlreadyRunningError, type PromptAttachmentError } from "./errors";
import type { ActivePromptRun } from "./run-registry";

export type PromptSessionForThreadError =
  | ActiveSessionError
  | PromptAlreadyRunningError
  | PromptAttachmentError
  | PromptError;

export interface PromptSessionForThreadInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
  readonly text: string;
  readonly attachments?: readonly ChatAttachment[];
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
    const session = yield* Result.await(getActiveSessionForThread(input.ctx, input.thread));

    const run = yield* input.ctx.app.services.promptRuns.tryStart({
      sessionRef: session.ref,
      requestId: input.ctx.requestId,
      now: input.ctx.app.services.now().toISOString(),
    });

    const signal = composeAbortSignals([input.ctx.signal, run.signal]);
    const materializedResult = await materializePromptAttachments({
      text: input.text,
      attachments: input.attachments ?? [],
      config: input.ctx.app.config.prompt.attachments,
      signal,
    });

    if (materializedResult.isErr()) {
      run.release();
      return Result.err(materializedResult.error);
    }

    const materialized = materializedResult.value;
    const promptInput = createHarnessPromptInput<TAdapters, keyof TAdapters>({
      ref: toConfiguredSessionRef<TAdapters>(session.ref),
      cwd: session.cwd,
      content: materialized.content,
      signal,
    });
    const promptedResult = await input.ctx.app.harness.prompt(
      promptInput as PromptInput<TAdapters>,
    );

    if (promptedResult.isErr()) {
      await materialized.cleanup();
      run.release();
      return Result.err(promptedResult.error);
    }

    const prompted = promptedResult.value;

    return Result.ok({
      session,
      events: observePromptRunEvents({ events: prompted, run, cleanup: materialized.cleanup }),
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
  readonly content: readonly HarnessPromptContent[];
  readonly signal: AbortSignal;
}): PromptInputFor<TAdapters, THarnessId> {
  return {
    ref: input.ref,
    cwd: input.cwd,
    content: input.content,
    adapterOptions: {} as AdapterOptionsFor<TAdapters, THarnessId>,
    signal: input.signal,
  };
}

async function* observePromptRunEvents(input: {
  readonly events: AsyncIterable<HarnessPromptEvent>;
  readonly run: ActivePromptRun;
  cleanup(): Promise<void>;
}): AsyncIterable<HarnessPromptEvent> {
  try {
    for await (const event of input.events) {
      input.run.recordEvent(event);
      yield event;
    }
  } finally {
    await input.cleanup();
    input.run.release();
  }
}
