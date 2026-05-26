import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type {
  GetThinkingError,
  GetThinkingInput,
  HarnessAdapterDefinitions,
  HarnessSelectedThinking,
  SetThinkingError,
  SetThinkingInput,
} from "@xmux/harness-core";
import { Result } from "better-result";
import type { HandlerContext } from "../../ctx";
import type { StoreError } from "../../errors";
import type { ChatThreadRef, SessionRecord } from "../../store";
import {
  ThinkingLevelInvalidError,
  ThinkingLevelUnsupportedError,
  ThinkingNoActiveSessionError,
  ThinkingSessionClosedError,
  ThinkingSessionRecordMissingError,
} from "./errors";
import { parseThinkingSelector, type ParsedThinkingSelector } from "./selector";

export type ThinkingCommandError =
  | StoreError
  | GetThinkingError
  | SetThinkingError
  | ThinkingLevelInvalidError
  | ThinkingLevelUnsupportedError
  | ThinkingNoActiveSessionError
  | ThinkingSessionRecordMissingError
  | ThinkingSessionClosedError;

export type ThinkingCommandOutput =
  | ThinkingShownOutput
  | ThinkingUpdatedOutput
  | ThinkingClearedOutput;

export interface ThinkingShownOutput {
  readonly status: "shown";
  readonly session: SessionRecord;
  readonly current: HarnessSelectedThinking;
}

export interface ThinkingUpdatedOutput {
  readonly status: "updated";
  readonly session: SessionRecord;
  readonly selected: HarnessSelectedThinking;
}

export interface ThinkingClearedOutput {
  readonly status: "cleared";
  readonly session: SessionRecord;
  readonly selected: HarnessSelectedThinking;
}

export interface ThinkingSessionCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
  readonly level?: string;
}

/** Shows or updates the thinking level for the active session bound to a chat thread. */
export async function thinkingSessionCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: ThinkingSessionCommandInput<TAdapters, TChats>,
): Promise<Result<ThinkingCommandOutput, ThinkingCommandError>> {
  const session = await getThinkingSessionForThread({ ctx: input.ctx, thread: input.thread });

  if (session.isErr()) {
    return Result.err(session.error);
  }

  const parsed = parseThinkingSelector(input.level);

  if (parsed.isErr()) {
    return Result.err(parsed.error);
  }

  if (parsed.value.type === "show") {
    const current = await getSessionThinking({ ctx: input.ctx, session: session.value });

    return current.isErr()
      ? Result.err(current.error)
      : Result.ok({ status: "shown", session: session.value, current: current.value });
  }

  if (parsed.value.type === "set") {
    const supported = await ensureSupportedThinkingLevel({
      ctx: input.ctx,
      session: session.value,
      parsed: parsed.value,
    });

    if (supported.isErr()) {
      return Result.err(supported.error);
    }
  }

  const selected = await input.ctx.app.harness.setThinking({
    target: { type: "session", ref: session.value.ref },
    update:
      parsed.value.type === "clear"
        ? { type: "clear" }
        : { type: "set", level: parsed.value.level },
    signal: input.ctx.signal,
  } as SetThinkingInput<TAdapters>);

  if (selected.isErr()) {
    return Result.err(selected.error);
  }

  return Result.ok({
    status: parsed.value.type === "clear" ? "cleared" : "updated",
    session: session.value,
    selected: selected.value as HarnessSelectedThinking,
  });
}

interface GetThinkingSessionForThreadInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
}

async function getThinkingSessionForThread<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: GetThinkingSessionForThreadInput<TAdapters, TChats>,
): Promise<
  Result<
    SessionRecord,
    | StoreError
    | ThinkingNoActiveSessionError
    | ThinkingSessionRecordMissingError
    | ThinkingSessionClosedError
  >
> {
  const binding = await input.ctx.app.store.threadBindings.get(input.thread);

  if (binding.isErr()) {
    return Result.err(binding.error);
  }

  if (!binding.value) {
    return Result.err(new ThinkingNoActiveSessionError({ thread: input.thread }));
  }

  const session = await input.ctx.app.store.sessions.get(binding.value.sessionRef);

  if (session.isErr()) {
    return Result.err(session.error);
  }

  if (!session.value) {
    return Result.err(
      new ThinkingSessionRecordMissingError({ sessionRef: binding.value.sessionRef }),
    );
  }

  if (session.value.status !== "open") {
    return Result.err(new ThinkingSessionClosedError({ sessionRef: session.value.ref }));
  }

  return Result.ok(session.value);
}

async function getSessionThinking<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly session: SessionRecord;
}): Promise<Result<HarnessSelectedThinking, GetThinkingError>> {
  const current = await input.ctx.app.harness.getThinking({
    target: { type: "session", ref: input.session.ref },
    signal: input.ctx.signal,
  } as GetThinkingInput<TAdapters>);

  return current.isErr()
    ? Result.err(current.error)
    : Result.ok(current.value as HarnessSelectedThinking);
}

async function ensureSupportedThinkingLevel<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly session: SessionRecord;
  readonly parsed: Extract<ParsedThinkingSelector, { readonly type: "set" }>;
}): Promise<Result<void, GetThinkingError | ThinkingLevelUnsupportedError>> {
  const current = await getSessionThinking({ ctx: input.ctx, session: input.session });

  if (current.isErr()) {
    return Result.err(current.error);
  }

  const supportedLevels = current.value.supportedLevels;
  if (supportedLevels === undefined || supportedLevels.includes(input.parsed.level)) {
    return Result.ok();
  }

  return Result.err(
    new ThinkingLevelUnsupportedError({
      level: input.parsed.level,
      supportedLevels,
    }),
  );
}
