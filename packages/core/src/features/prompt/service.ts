import type { ChatAdapterDefinitions, ChatAttachment } from "@xmux/chat-core";
import type {
  AdapterOptionsFor,
  HarnessAdapterDefinitions,
  HarnessPromptEvent,
  HarnessModelInfo,
  HarnessModelRef,
  HarnessPromptContent,
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
import { materializePromptAttachments } from "./attachments";
import {
  PromptAlreadyRunningError,
  PromptAttachmentUnsupportedError,
  type PromptAttachmentError,
} from "./errors";
import type { ActivePromptRun } from "./run-registry";

export type PromptSessionForThreadError =
  | StoreError
  | NoActiveSessionError
  | SessionRecordMissingError
  | SessionClosedError
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
    const session = yield* Result.await(
      getPromptSessionForThread({ ctx: input.ctx, thread: input.thread }),
    );

    const run = yield* input.ctx.app.services.promptRuns.tryStart({
      sessionRef: session.ref,
      requestId: input.ctx.requestId,
      now: input.ctx.app.services.now().toISOString(),
    });

    const signal = composeAbortSignals([input.ctx.signal, run.signal]);
    const capabilities = await validatePromptAttachmentCapabilities({
      ctx: input.ctx,
      session,
      attachments: input.attachments ?? [],
      signal,
    });

    if (capabilities.isErr()) {
      run.release();
      return Result.err(capabilities.error);
    }

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

async function validatePromptAttachmentCapabilities<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly session: SessionRecord;
  readonly attachments: readonly ChatAttachment[];
  readonly signal: AbortSignal;
}): Promise<Result<void, PromptAttachmentUnsupportedError>> {
  const required = requiredModelInputKinds(input.attachments);
  if (required.length === 0) return Result.ok();

  const ref = toConfiguredSessionRef<TAdapters>(input.session.ref);
  const selected = await input.ctx.app.harness.getModel({
    target: { type: "session", ref },
    signal: input.signal,
  } as Parameters<typeof input.ctx.app.harness.getModel>[0]);
  if (selected.isErr() || selected.value.model === undefined) return Result.ok();

  const models = await input.ctx.app.harness.listModels({
    harnessId: ref.harnessId,
    cwd: input.session.cwd,
    includeUnavailable: true,
    signal: input.signal,
  } as Parameters<typeof input.ctx.app.harness.listModels>[0]);
  if (models.isErr()) return Result.ok();

  const model = findModelInfo(models.value as readonly HarnessModelInfo[], selected.value.model);
  const supported = model?.capabilities?.input;
  if (supported === undefined) return Result.ok();

  for (const kind of required) {
    if (!supported.includes(kind)) {
      const attachment = input.attachments.find((candidate) =>
        requiredModelInputKinds([candidate]).includes(kind),
      );
      return Result.err(
        new PromptAttachmentUnsupportedError({
          attachmentId: attachment?.attachmentId ?? "unknown",
          kind: attachment?.kind ?? "other",
          reason: "model_unsupported",
          detail: `The active model does not advertise ${kind} input support`,
        }),
      );
    }
  }

  return Result.ok();
}

function requiredModelInputKinds(
  attachments: readonly ChatAttachment[],
): readonly ("image" | "audio" | "video" | "pdf")[] {
  const required = new Set<"image" | "audio" | "video" | "pdf">();

  for (const attachment of attachments) {
    switch (attachment.kind) {
      case "image":
        required.add("image");
        break;
      case "audio":
        required.add("audio");
        break;
      case "video":
        required.add("video");
        break;
      case "document":
      case "archive":
      case "other":
        if (isPdfAttachment(attachment)) required.add("pdf");
        break;
    }
  }

  return [...required];
}

function isPdfAttachment(attachment: ChatAttachment): boolean {
  return (
    attachment.mimeType === "application/pdf" ||
    attachment.filename?.toLocaleLowerCase().endsWith(".pdf") === true
  );
}

function findModelInfo(
  models: readonly HarnessModelInfo[],
  selected: HarnessModelRef,
): HarnessModelInfo | undefined {
  return models.find((model) =>
    model.ref.providerId === selected.providerId &&
    model.ref.modelId === selected.modelId &&
    model.ref.variant === selected.variant,
  );
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
