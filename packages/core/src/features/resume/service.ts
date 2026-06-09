import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type {
  HarnessAdapterDefinitions,
  HarnessModelRef,
  HarnessSessionInfo,
  ListSessionsError,
  ResumeSessionError,
  ResumeSessionInput,
} from "@xmux/harness-core";
import { Result } from "better-result";
import type { HandlerContext } from "../../ctx";
import type { StoreError } from "../../errors";
import {
  createSessionRecord,
  createThreadBinding,
  type ActorRef,
  type ChatThreadRef,
  type SessionRecord,
} from "../../store";
import {
  parseSessionTarget,
  selectSessionByShortId,
  type SelectSessionByShortIdError,
} from "../shared/session-command";
import type { SessionCommandIncompleteTargetError } from "../shared/session-command";
import type { HarnessSelectionOutput } from "../shared/harness-selection";
import {
  listHarnessSelectableSessions,
  type SessionSelectionGroup,
} from "../shared/session-selection";
import { getCurrentWorkspaceCwd, type GetCurrentWorkspaceCwdError } from "../workspace";
import { CommandHarnessNotConfiguredError } from "../errors";
import { requireConfiguredHarnessId } from "../utils";

export type ResumeCommandError =
  | StoreError
  | GetCurrentWorkspaceCwdError
  | ListSessionsError
  | ResumeSessionError
  | SelectSessionByShortIdError
  | SessionCommandIncompleteTargetError
  | CommandHarnessNotConfiguredError;

export type ResumeCommandOutput = ResumeHarnessesOutput | ResumeListOutput | ResumeActivatedOutput;

/** Picker output shared with the other session commands (see `/new`, `/delete`). */
export type ResumeHarnessesOutput = HarnessSelectionOutput;

export interface ResumeListOutput {
  readonly status: "listed";
  readonly cwd: string;
  readonly group: SessionSelectionGroup;
}

export interface ResumeActivatedOutput {
  readonly status: "resumed";
  readonly session: SessionRecord;
  readonly shortId: string;
  readonly model: HarnessModelRef;
}

export interface ResumeSessionCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
  readonly harnessId?: string;
  readonly shortId?: string;
}

export async function resumeSessionCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: ResumeSessionCommandInput<TAdapters, TChats>,
): Promise<Result<ResumeCommandOutput, ResumeCommandError>> {
  return Result.gen(async function* () {
    const target = yield* parseSessionTarget({
      command: "resume",
      harnessId: input.harnessId,
      shortId: input.shortId,
    });

    const cwd = yield* Result.await(
      getCurrentWorkspaceCwd({ ctx: input.ctx.app, thread: input.thread }),
    );

    if (target.status === "list") {
      return Result.ok({
        status: "harnesses" as const,
        cwd,
        harnessIds: input.ctx.app.harnessIds,
      });
    }

    const selected = yield* Result.await(
      selectSessionByShortId({
        ctx: input.ctx,
        cwd,
        harnessId: target.harnessId,
        shortId: target.shortId,
      }),
    );

    const resumed = yield* Result.await(
      input.ctx.app.harness.resumeSession(
        createHarnessResumeInput({
          harnessId: target.harnessId,
          sessionId: selected.sessionId,
          cwd,
          signal: input.ctx.signal,
        }) as ResumeSessionInput<TAdapters>,
      ),
    );

    const stored = yield* Result.await(
      upsertResumedSessionRecord({
        ctx: input.ctx,
        thread: input.thread,
        cwd: resumed.cwd ?? cwd,
        session: resumed,
      }),
    );

    const now = input.ctx.app.services.now().toISOString();
    yield* Result.await(
      input.ctx.app.store.threadBindings.bind(
        createThreadBinding({ thread: input.thread, sessionRef: stored.ref, now }),
      ),
    );

    return Result.ok({
      status: "resumed" as const,
      session: stored,
      shortId: input.shortId ?? selected.shortId,
      model: resumed.model ?? { modelId: "unknown", providerId: "unknown" },
    });
  });
}

export async function listResumeSessionsForHarness<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
  readonly harnessId: string;
}): Promise<Result<ResumeListOutput, ResumeCommandError>> {
  return Result.gen(async function* () {
    const cwd = yield* Result.await(
      getCurrentWorkspaceCwd({ ctx: input.ctx.app, thread: input.thread }),
    );
    const harnessId = yield* requireConfiguredHarnessId({
      harnessId: input.harnessId,
      availableHarnessIds: input.ctx.app.harnessIds,
      onMissing: (args) => new CommandHarnessNotConfiguredError(args),
    });
    const group = yield* Result.await(
      listHarnessSelectableSessions({
        ctx: input.ctx,
        harnessId,
        cwd,
        maxSessions: input.ctx.app.config.resume.maxSessionsPerHarness,
      }),
    );

    return Result.ok({ status: "listed" as const, cwd, group });
  });
}

async function upsertResumedSessionRecord<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
  readonly cwd: string;
  readonly session: HarnessSessionInfo;
}): Promise<Result<SessionRecord, StoreError>> {
  return Result.gen(async function* () {
    const existing = yield* Result.await(input.ctx.app.store.sessions.get(input.session.ref));

    const now = input.ctx.app.services.now().toISOString();

    if (existing) {
      return Result.ok(
        yield* Result.await(
          input.ctx.app.store.sessions.update(input.session.ref, {
            status: "open",
            deliveryMode: input.ctx.app.config.deliveryMode,
            updatedAt: now,
            closedAt: undefined,
            ...(input.session.title === undefined ? {} : { title: input.session.title }),
          }),
        ),
      );
    }

    return Result.ok(
      yield* Result.await(
        input.ctx.app.store.sessions.create(
          createSessionRecord({
            ref: input.session.ref,
            origin: input.thread,
            requester: input.ctx.actor ?? UNKNOWN_ACTOR,
            cwd: input.cwd,
            deliveryMode: input.ctx.app.config.deliveryMode,
            title: input.session.title,
            now,
          }),
        ),
      ),
    );
  });
}

const UNKNOWN_ACTOR = { userId: "unknown" } satisfies ActorRef;

function createHarnessResumeInput<THarnessId extends string>(input: {
  readonly harnessId: THarnessId;
  readonly sessionId: string;
  readonly cwd: string;
  readonly signal: AbortSignal;
}) {
  return {
    harnessId: input.harnessId,
    sessionId: input.sessionId,
    cwd: input.cwd,
    signal: input.signal,
  };
}
