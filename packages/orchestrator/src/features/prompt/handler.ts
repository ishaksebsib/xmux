import type {
  ChatActor,
  ChatAdapterObject,
  ChatConversationRef,
  ChatMessage,
  ChatTextInput,
  ChatTextStreamChunk,
  ChatTextStreamContent,
} from "@xmux/chat-core";
import type { ChatAdapterDefinitions, ChatSendActionInput } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions, HarnessPromptEvent } from "@xmux/harness-core";
import { Result } from "better-result";
import type { Actions } from "../../actions";
import type { NormalizedPromptResponseConfig } from "../../config";
import type { HandlerContext } from "../../ctx";
import type { SessionRecord } from "../../store";
import { replyToChatEvent, streamReplyToChatEvent, threadFromChatEvent } from "../utils";
import { formatInteractionActionMessage } from "../interaction/response";
import { PromptResponseError } from "./errors";
import { formatPromptFailure } from "./response";
import { promptSessionForThread } from "./service";
import { createPromptEventRenderer, splitPromptStreamDelta } from "./stream";

export interface HandlePromptMessageInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: PromptMessageEvent;
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
    return replyToChatEvent({
      event: input.event,
      message: formatPromptFailure(prompted.error),
      onError: (cause) => new PromptResponseError({ cause }),
    });
  }

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

  return streamed;
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
