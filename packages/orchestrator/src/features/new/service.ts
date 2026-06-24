import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type {
  CreateSessionError,
  CreateSessionInput,
  HarnessAdapterDefinitions,
} from "@xmux/harness-core";
import { Result } from "better-result";
import type { HandlerContext } from "../../ctx";
import { type StoreError } from "../../errors";
import {
  createSessionRecord,
  createThreadBinding,
  type ActorRef,
  type ChatThreadRef,
  type SessionRecord,
} from "../../store";
import { requireConfiguredHarnessId } from "../utils";
import { getCurrentWorkspaceCwd } from "../workspace";
import { CommandHarnessNotConfiguredError } from "../errors";
import { resolveHarnessChoice, type HarnessSelectionOutput } from "../shared/harness-selection";

export type CreateSessionForThreadError =
  | CommandHarnessNotConfiguredError
  | CreateSessionError
  | StoreError;

/** Outcome of `/new`: either a harness picker prompt, or a created session. */
export type NewCommandOutput = HarnessSelectionOutput | NewSessionCreatedOutput;

export interface NewSessionCreatedOutput {
  readonly status: "created";
  readonly record: SessionRecord;
}

export interface NewSessionCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
  readonly harnessId?: string;
  readonly title?: string;
}

/**
 * Routes the `/new` command: with no harness chosen, returns the configured
 * harness ids so the caller can render a picker; otherwise creates the session.
 */
export async function newSessionCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: NewSessionCommandInput<TAdapters, TChats>,
): Promise<Result<NewCommandOutput, CreateSessionForThreadError>> {
  return Result.gen(async function* () {
    const cwd = yield* Result.await(
      getCurrentWorkspaceCwd({ ctx: input.ctx.app, thread: input.thread }),
    );

    const harness = yield* resolveHarnessChoice({
      harnessId: input.harnessId,
      availableHarnessIds: input.ctx.app.harnessIds,
      cwd,
    });

    if (harness.status === "harnesses") {
      return Result.ok(harness);
    }

    const record = yield* Result.await(
      createSessionForThread({
        ctx: input.ctx,
        thread: input.thread,
        harnessId: harness.harnessId,
        cwd,
        ...(input.title === undefined ? {} : { title: input.title }),
      }),
    );

    return Result.ok({ status: "created" as const, record });
  });
}

export interface CreateSessionForThreadInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
  readonly harnessId: string;
  readonly cwd?: string;
  readonly title?: string;
}

/** Creates a harness session and attaches the requesting chat thread to it. */
export async function createSessionForThread<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: CreateSessionForThreadInput<TAdapters, TChats>,
): Promise<Result<SessionRecord, CreateSessionForThreadError>> {
  return Result.gen(async function* () {
    const harnessId = yield* requireConfiguredHarnessId({
      harnessId: input.harnessId,
      availableHarnessIds: input.ctx.app.harnessIds,
      onMissing: (args) => new CommandHarnessNotConfiguredError(args),
    });

    const cwd =
      input.cwd ??
      (yield* Result.await(getCurrentWorkspaceCwd({ ctx: input.ctx.app, thread: input.thread })));

    const created = yield* Result.await(
      input.ctx.app.harness.createSession(
        createHarnessSessionInput({
          harnessId,
          cwd,
          title: input.title,
          signal: input.ctx.signal,
        }) as CreateSessionInput<TAdapters>,
      ),
    );

    const now = input.ctx.app.services.now().toISOString();
    const record = createSessionRecord({
      origin: input.thread,
      requester: input.ctx.actor ?? UNKNOWN_ACTOR,
      cwd: created.cwd,
      ref: created.ref,
      title: created.title,
      now,
    });

    const stored = yield* Result.await(input.ctx.app.store.sessions.create(record));

    const binding = createThreadBinding({
      thread: input.thread,
      sessionRef: stored.ref,
      now,
    });

    yield* Result.await(input.ctx.app.store.threadBindings.bind(binding));

    return Result.ok(stored);
  });
}

const UNKNOWN_ACTOR = { userId: "unknown" } satisfies ActorRef;

function createHarnessSessionInput<THarnessId extends string>(input: {
  readonly harnessId: THarnessId;
  readonly cwd: string;
  readonly title?: string;
  readonly signal: AbortSignal;
}) {
  return {
    harnessId: input.harnessId,
    cwd: input.cwd,
    ...(input.title === undefined ? {} : { title: input.title }),
    signal: input.signal,
  };
}
