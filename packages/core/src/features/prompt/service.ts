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
import type { PromptRunLease } from "./run-registry";

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

  const lease = input.ctx.app.services.promptRuns.tryStart({
    sessionRef: session.value.ref,
    requestId: input.ctx.requestId,
    now: input.ctx.app.services.now().toISOString(),
  });

  if (lease.isErr()) {
    return Result.err(lease.error);
  }

  const prompted = await input.ctx.app.harness.prompt(
    createHarnessPromptInput({
      ref: session.value.ref,
      text: input.text,
      signal: input.ctx.signal,
    }) as unknown as PromptInput<TAdapters>,
  );

  if (prompted.isErr()) {
    lease.value.release();
    return Result.err(prompted.error);
  }

  return Result.ok({
    session: session.value,
    events: releaseLeaseAfterStream({ events: prompted.value, lease: lease.value }),
    release: lease.value.release,
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

function createHarnessPromptInput(input: {
  readonly ref: SessionRecord["ref"];
  readonly text: string;
  readonly signal: AbortSignal;
}) {
  return {
    ref: input.ref,
    content: [{ type: "text", text: input.text }] as const,
    signal: input.signal,
  };
}

async function* releaseLeaseAfterStream(input: {
  readonly events: AsyncIterable<HarnessPromptEvent>;
  readonly lease: PromptRunLease;
}): AsyncIterable<HarnessPromptEvent> {
  try {
    yield* input.events;
  } finally {
    input.lease.release();
  }
}
