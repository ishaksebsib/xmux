import type {
  ChatActionEvent,
  ChatActor,
  ChatAdapterDefinitions,
  ChatAdapterObject,
  ChatCommandValues,
  ChatConversationRef,
  ChatMessage,
  ChatSendActionInput,
  ChatTextInput,
  ChatTextStreamChunk,
  ChatTextStreamContent,
} from "@xmux/chat-core";
import { HarnessSessionNotFoundError } from "@xmux/harness-core";
import type { HarnessAdapterDefinitions, HarnessPromptEvent } from "@xmux/harness-core";
import { Result } from "better-result";
import { sessionStartActionId, type Actions } from "../../actions";
import type { Commands } from "../../commands";
import type { NormalizedPromptResponseConfig } from "../../config";
import type { HandlerContext } from "../../ctx";
import type { SessionRecord } from "../../store";
import { xmuxLogEvents } from "../../logger";
import { serializeXmuxLogError } from "../../logger-utils";
import {
  replyToChatEvent,
  streamReplyToChatEvent,
  threadFromChatEvent,
  toSendActionInput,
} from "../utils";
import { markSessionDeletedUpstream } from "../session";
import { formatInteractionActionMessage } from "../interaction/response";
import { NoActiveSessionError } from "../errors";
import { PromptAlreadyRunningError, PromptResponseError } from "./errors";
import { formatNoActivePromptActionMessage, formatPromptFailure } from "./response";
import { promptSessionForThread } from "./service";
import { createPromptEventRenderer, splitPromptStreamDelta } from "./stream";

export interface HandlePromptMessageInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: PromptMessageEvent<Extract<keyof TChats, string>>;
}

export interface HandlePromptSessionStartActionInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: ChatActionEvent<
    Actions,
    typeof sessionStartActionId,
    Extract<keyof TChats, string>,
    Result<unknown, unknown>
  >;
}

export interface PromptMessageEvent<
  TChatId extends string = string,
  TAdapterData extends ChatAdapterObject = ChatAdapterObject,
> {
  readonly type: "message";
  readonly chatId: TChatId;
  readonly conversation: ChatConversationRef<TChatId>;
  readonly message: ChatMessage<TChatId, TAdapterData>;
  readonly reply: (message: ChatTextInput) => Promise<Result<unknown, unknown>>;
  readonly replyStream: (
    content: ChatTextStreamContent,
    options?: { readonly mode?: "auto" | "thread" | "quote" | "conversation" },
  ) => Promise<Result<unknown, unknown>>;
}

/** Handles normal chat messages as prompts for the active session. */
export async function handlePromptMessage<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: HandlePromptMessageInput<TAdapters, TChats>): Promise<Result<void, PromptResponseError>> {
  const prompted = await promptSessionForThread({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    text: input.event.message.text,
    attachments: input.event.message.attachments,
  });

  if (prompted.isErr()) {
    if (PromptAlreadyRunningError.is(prompted.error)) {
      const offered = await input.ctx.app.services.promptEvents.emit({
        type: "prompt.busy",
        ctx: input.ctx,
        event: input.event,
        thread: threadFromChatEvent(input.event),
        error: prompted.error,
      });

      if (offered.isOk() && offered.value.handledCount > 0) return Result.ok();
      if (offered.isErr()) logPromptEventDispatchFailure(input.ctx, "prompt.busy", offered.error);
    }

    const rejected = await input.ctx.app.services.promptEvents.emit({
      type: "prompt.rejected",
      ctx: input.ctx,
      event: input.event,
      thread: threadFromChatEvent(input.event),
      error: prompted.error,
      requestId: input.ctx.requestId,
    });
    if (rejected.isErr())
      logPromptEventDispatchFailure(input.ctx, "prompt.rejected", rejected.error);

    if (NoActiveSessionError.is(prompted.error)) {
      return sendNoActiveSessionActions(input);
    }

    return replyToChatEvent({
      event: input.event,
      message: formatPromptFailure(prompted.error),
      onError: (cause) => new PromptResponseError({ cause }),
    });
  }

  const started = await input.ctx.app.services.promptEvents.emit({
    type: "prompt.started",
    ctx: input.ctx,
    event: input.event,
    thread: threadFromChatEvent(input.event),
    session: prompted.value.session,
    requestId: input.ctx.requestId,
  });
  if (started.isErr()) logPromptEventDispatchFailure(input.ctx, "prompt.started", started.error);

  const streamed = await streamPromptReplyInMessages({
    ctx: input.ctx,
    session: prompted.value.session,
    event: input.event,
    events: prompted.value.events,
    responseConfig: input.ctx.app.config.prompt.response,
  });

  if (streamed.isErr()) {
    prompted.value.cancel(streamed.error);
    prompted.value.release();
  }

  const settled = await input.ctx.app.services.promptEvents.emit({
    type: "prompt.settled",
    ctx: input.ctx,
    event: input.event,
    thread: threadFromChatEvent(input.event),
    session: prompted.value.session,
    requestId: input.ctx.requestId,
  });
  if (settled.isErr()) logPromptEventDispatchFailure(input.ctx, "prompt.settled", settled.error);

  return streamed;
}

export async function handlePromptSessionStartAction<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandlePromptSessionStartActionInput<TAdapters, TChats>,
): Promise<Result<void, PromptResponseError>> {
  const acknowledged = await input.event.ack();
  if (acknowledged.isErr()) {
    return Result.err(new PromptResponseError({ cause: acknowledged.error }));
  }

  const injected = await input.ctx.app.chat.injectCommand({
    chatId: input.event.chatId,
    conversationId: input.event.conversation.conversationId,
    messageId: input.event.message.messageId,
    actor: input.event.actor,
    command: sessionStartCommand(input.event.value),
  });

  return Result.mapError(injected, (cause) => new PromptResponseError({ cause }));
}

function sessionStartCommand(value: "new" | "resume"): ChatCommandValues<Commands> {
  switch (value) {
    case "new":
      return {
        name: "new",
        options: { harnessId: undefined, title: undefined },
      } satisfies ChatCommandValues<Commands>;
    case "resume":
      return {
        name: "resume",
        options: { harnessId: undefined, shortId: undefined },
      } satisfies ChatCommandValues<Commands>;
  }
}

async function sendNoActiveSessionActions<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: HandlePromptMessageInput<TAdapters, TChats>): Promise<Result<void, PromptResponseError>> {
  const message = formatNoActivePromptActionMessage();
  const sent = await input.ctx.app.chat.sendAction(
    toSendActionInput({ ctx: input.ctx, event: input.event }, message),
  );

  return Result.map(
    Result.mapError(sent, (cause) => new PromptResponseError({ cause })),
    () => undefined,
  );
}

function logPromptEventDispatchFailure<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(ctx: HandlerContext<TAdapters, TChats>, eventType: string, error: unknown): void {
  ctx.logger.warn(xmuxLogEvents.backgroundFailure, {
    operation: "prompt",
    result: "error",
    reason: "prompt_event_dispatch_failed",
    eventType,
    error: serializeXmuxLogError(error),
  });
}

interface StreamPromptReplyInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly session: SessionRecord;
  readonly event: PromptMessageEvent;
  readonly events: AsyncIterable<HarnessPromptEvent>;
  readonly responseConfig: NormalizedPromptResponseConfig;
}

interface ActiveChatStream {
  readonly chunks: ChatTextStreamQueue;
  readonly result: Promise<Result<void, PromptResponseError>>;
}

async function streamPromptReplyInMessages<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: StreamPromptReplyInput<TAdapters, TChats>): Promise<Result<void, PromptResponseError>> {
  const renderer = createPromptEventRenderer({ response: input.responseConfig });
  let activeStream: ActiveChatStream | undefined;

  const startStream = (): ActiveChatStream => {
    const chunks = new ChatTextStreamQueue();
    const result = streamReplyToChatEvent({
      event: input.event,
      content: {
        chunks,
        format: "markdown",
      },
      onError: (cause) => new PromptResponseError({ cause }),
    });

    return { chunks, result };
  };

  const appendToStream = (delta: string): void => {
    if (delta.length === 0) return;
    activeStream ??= startStream();
    for (const chunk of splitPromptStreamDelta(delta, input.responseConfig.maxStreamDeltaChars)) {
      activeStream.chunks.push({ type: "delta", delta: chunk });
    }
  };

  const completeActiveStream = async (): Promise<Result<void, PromptResponseError>> => {
    if (!activeStream) return Result.ok();

    const stream = activeStream;
    activeStream = undefined;
    stream.chunks.complete();
    return stream.result;
  };

  try {
    for await (const event of input.events) {
      if (event.type === "interaction") {
        const completed = await completeActiveStream();
        if (completed.isErr()) return completed;
        renderer.resetMessageBoundary();

        const sent = await sendInteractionPrompt({
          ctx: input.ctx,
          session: input.session,
          event: input.event,
          interaction: event,
        });
        if (sent.isErr()) return sent;
        continue;
      }

      const upstreamDeleted = getPromptSessionNotFoundError(event);
      if (upstreamDeleted !== undefined) {
        const completed = await completeActiveStream();
        if (completed.isErr()) return completed;

        const cleanup = await markSessionDeletedUpstream({
          ctx: input.ctx,
          ref: input.session.ref,
          operation: "prompt",
          cause: upstreamDeleted,
        });

        const message = formatPromptFailure(cleanup.isOk() ? cleanup.value : cleanup.error);

        return replyToChatEvent({
          event: input.event,
          message,
          onError: (cause) => new PromptResponseError({ cause }),
        });
      }

      appendToStream(renderer.render(event));
    }

    return completeActiveStream();
  } catch (cause) {
    const stream = activeStream;
    activeStream = undefined;
    stream?.chunks.complete();
    await stream?.result;
    return Result.err(new PromptResponseError({ cause }));
  } finally {
    activeStream?.chunks.complete();
  }
}

function getPromptSessionNotFoundError(
  event: HarnessPromptEvent,
): HarnessSessionNotFoundError | undefined {
  if (event.type !== "run" || event.phase !== "failed") return undefined;

  return HarnessSessionNotFoundError.is(event.error) ? event.error : undefined;
}

async function sendInteractionPrompt<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly session: SessionRecord;
  readonly event: PromptMessageEvent;
  readonly interaction: Extract<HarnessPromptEvent, { readonly type: "interaction" }>;
}): Promise<Result<void, PromptResponseError>> {
  if (input.interaction.phase !== "requested") return Result.ok();

  const ordinal = input.ctx.app.services.promptRuns
    .get(input.session.ref)
    ?.pendingInteractions.find(
      (pending) => pending.requestId === input.interaction.requestId,
    )?.ordinal;
  if (ordinal === undefined) return Result.ok();

  const message = formatInteractionActionMessage({
    ordinal,
    request: {
      kind: input.interaction.kind,
      prompt: input.interaction.prompt,
      title: input.interaction.title,
      permission: input.interaction.permission,
      question: input.interaction.question,
    },
  });

  const sent = await input.ctx.app.chat.sendAction({
    chatId: input.event.chatId,
    conversationId: input.event.conversation.conversationId,
    text: message.text,
    format: message.format,
    buttons: message.buttons,
    signal: input.ctx.signal,
  } as ChatSendActionInput<TChats, Actions>);

  return Result.map(
    Result.mapError(sent, (cause) => new PromptResponseError({ cause })),
    () => undefined,
  );
}

class ChatTextStreamQueue implements AsyncIterable<ChatTextStreamChunk> {
  private readonly chunks: ChatTextStreamChunk[] = [];
  private pending?: (result: IteratorResult<ChatTextStreamChunk>) => void;
  private closed = false;

  push(chunk: ChatTextStreamChunk): void {
    if (this.closed) return;

    if (this.pending) {
      const pending = this.pending;
      this.pending = undefined;
      pending({ done: false, value: chunk });
      return;
    }

    this.chunks.push(chunk);
  }

  complete(): void {
    if (this.closed) return;

    this.closed = true;
    const completed = { type: "completed" } satisfies ChatTextStreamChunk;

    if (this.pending) {
      const pending = this.pending;
      this.pending = undefined;
      pending({ done: false, value: completed });
      return;
    }

    this.chunks.push(completed);
  }

  [Symbol.asyncIterator](): AsyncIterator<ChatTextStreamChunk> {
    return {
      next: () => this.next(),
    };
  }

  private next(): Promise<IteratorResult<ChatTextStreamChunk>> {
    const chunk = this.chunks.shift();
    if (chunk) {
      return Promise.resolve({ done: false, value: chunk });
    }

    if (this.closed) {
      return Promise.resolve({ done: true, value: undefined });
    }

    return new Promise((resolve) => {
      this.pending = resolve;
    });
  }
}

export function isUserPromptActor(actor: ChatActor): boolean {
  return actor.kind === "user";
}
