import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type {
  CreateSessionError,
  CreateSessionInput,
  HarnessAdapterDefinitions,
} from "@xmux/harness-core";
import { Result } from "better-result";
import type { Config } from "../../config";
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
import { NewCommandHarnessNotConfiguredError } from "./errors";

export type CreateSessionForThreadError =
  | NewCommandHarnessNotConfiguredError
  | CreateSessionError
  | StoreError;

export interface CreateSessionForThreadInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
  readonly harnessId: string;
  readonly title?: string;
}

/** Creates a harness session and attaches the requesting chat thread to it. */
export async function createSessionForThread<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: CreateSessionForThreadInput<TAdapters, TChats>,
): Promise<Result<SessionRecord, CreateSessionForThreadError>> {
  const harnessId = requireConfiguredHarnessId({
    harnessId: input.harnessId,
    availableHarnessIds: input.ctx.app.harnessIds,
    onMissing: (args) => new NewCommandHarnessNotConfiguredError(args),
  });

  if (harnessId.isErr()) {
    return Result.err(harnessId.error);
  }

  const created = await input.ctx.app.harness.createSession(
    createHarnessSessionInput({
      harnessId: harnessId.value,
      config: input.ctx.app.config,
      title: input.title,
      signal: input.ctx.signal,
    }) as CreateSessionInput<TAdapters>,
  );

  if (created.isErr()) {
    return Result.err(created.error);
  }

  const now = input.ctx.app.services.now().toISOString();
  const record = createSessionRecord({
    origin: input.thread,
    requester: input.ctx.actor ?? UNKNOWN_ACTOR,
    cwd: created.value.cwd,
    deliveryMode: input.ctx.app.config.deliveryMode,
    ref: created.value.ref,
    title: created.value.title,
    now,
  });

  const stored = await input.ctx.app.store.sessions.create(record);
  if (stored.isErr()) {
    return Result.err(stored.error);
  }

  const binding = createThreadBinding({
    thread: input.thread,
    sessionRef: stored.value.ref,
    now,
  });

  const bound = await input.ctx.app.store.threadBindings.bind(binding);
  if (bound.isErr()) {
    return Result.err(bound.error);
  }

  return Result.ok(stored.value);
}

const UNKNOWN_ACTOR = { userId: "unknown" } satisfies ActorRef;

function createHarnessSessionInput<THarnessId extends string>(input: {
  readonly harnessId: THarnessId;
  readonly config: Config;
  readonly title?: string;
  readonly signal: AbortSignal;
}) {
  return {
    harnessId: input.harnessId,
    cwd: input.config.defaultWorkingDirectory,
    ...(input.title === undefined ? {} : { title: input.title }),
    signal: input.signal,
  };
}
