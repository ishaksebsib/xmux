import { Result } from "better-result";
import { vi } from "vitest";
import {
  defineChatAdapter,
  defineChatCommand,
  defineChatCommands,
  type ChatAdapterStartContext,
  type ChatAdapterStreamMessageInput,
  type ChatAttachment,
  type ChatCommandRegistry,
  type ChatAdapterStreamReplyInput,
  type ChatLogger,
  type OpenChatAdapterContext,
} from "../../src";

export const commands = defineChatCommands({
  start: defineChatCommand({ description: "Start" }),
});

export const basicCapabilities = {
  messages: {
    send: true,
    reply: true,
    edit: false,
    delete: false,
    typing: false,
    markdown: false,
    attachments: { receive: false, send: false, download: false },
  },
} as const;

export const streamCapabilities = {
  messages: {
    send: true,
    reply: true,
    edit: true,
    delete: false,
    typing: false,
    markdown: false,
    attachments: { receive: false, send: false, download: false },
    stream: { send: true, reply: true, strategy: "edit" },
  },
} as const;

export const typingCapabilities = {
  messages: {
    send: true,
    reply: true,
    edit: false,
    delete: false,
    typing: true,
    markdown: false,
    attachments: { receive: false, send: false, download: false },
  },
} as const;

export type Handles = {
  readonly opens: string[];
  readonly starts: string[];
  readonly closes: string[];
};

export function createHandles(): Handles {
  return { opens: [], starts: [], closes: [] };
}

export async function* textChunks(parts: readonly string[]) {
  for (const delta of parts) {
    yield { type: "delta" as const, delta };
  }
}

export async function* bytesChunks(chunks: readonly Uint8Array[]) {
  yield* chunks;
}

export function createMockLogger(): ChatLogger {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } satisfies ChatLogger;
}

export function createRuntimeAdapter<const TId extends string>(args: {
  readonly id: TId;
  readonly handles?: Handles;
  readonly closeError?: unknown;
  readonly openError?: unknown;
  readonly throwOnOpen?: unknown;
  readonly openThrow?: unknown;
  readonly sendError?: unknown;
  readonly startError?: unknown;
  readonly throwOnStart?: unknown;
  readonly startThrow?: unknown;
  readonly throwOnSend?: unknown;
  readonly sendThrow?: unknown;
  readonly nativeReply?: boolean;
  readonly nativeStream?: boolean;
  readonly nativeTyping?: boolean;
  readonly replyError?: unknown;
  readonly throwOnReply?: unknown;
  readonly replyThrow?: unknown;
  readonly typingError?: unknown;
  readonly throwOnTyping?: unknown;
  readonly typingThrow?: unknown;
  readonly sendActionError?: unknown;
  readonly sendActionThrow?: unknown;
  readonly respondToActionError?: unknown;
  readonly respondToActionThrow?: unknown;
  readonly streamMessageError?: unknown;
  readonly streamMessageThrow?: unknown;
  readonly streamReplyError?: unknown;
  readonly streamReplyThrow?: unknown;
  readonly onOpen?: (context: OpenChatAdapterContext) => void;
  readonly onStart?: (context: ChatAdapterStartContext<ChatCommandRegistry, TId>) => void;
  readonly onSend?: (input: {
    readonly adapterOptions: Record<never, never>;
    readonly conversationId: string;
    readonly text: string;
  }) => void;
  readonly onSendAction?: (input: {
    readonly adapterOptions: Record<never, never>;
    readonly conversationId: string;
    readonly text: string;
    readonly buttons: readonly (readonly unknown[])[];
  }) => void;
  readonly onRespondToAction?: (input: {
    readonly interactionId: string;
    readonly response: { readonly kind: string };
  }) => void;
  readonly onReply?: (input: {
    readonly message?: { readonly messageId: string };
    readonly mode?: string;
    readonly text: string;
  }) => void;
  readonly onStreamMessage?: (input: { readonly content: { readonly chunks: AsyncIterable<unknown> } }) => void;
  readonly onStreamReply?: (input: {
    readonly message?: { readonly messageId: string };
    readonly mode?: string;
    readonly content: { readonly chunks: AsyncIterable<unknown> };
  }) => void;
  readonly onTyping?: (input: {
    readonly conversationId: string;
    readonly message?: { readonly messageId: string };
    readonly adapterOptions: Record<never, never>;
  }) => void;
}) {
  const handles = args.handles ?? createHandles();
  const capabilities = args.nativeStream
    ? streamCapabilities
    : args.nativeTyping
      ? typingCapabilities
      : basicCapabilities;

  return defineChatAdapter<TId, Record<never, never>, Record<never, never>, typeof capabilities>({
    id: args.id,
    capabilities,
    async open(context) {
      args.onOpen?.(context);
      handles.opens.push(args.id);
      if ((args.throwOnOpen ?? args.openThrow) !== undefined) throw args.throwOnOpen ?? args.openThrow;
      if (args.openError !== undefined) return Result.err(args.openError);

      return Result.ok({
        id: args.id,
        async start(context) {
          handles.starts.push(args.id);
          if ((args.throwOnStart ?? args.startThrow) !== undefined) throw args.throwOnStart ?? args.startThrow;
          if (args.startError !== undefined) return Result.err(args.startError);
          args.onStart?.(context);
          return Result.ok();
        },
        async sendMessage(input) {
          args.onSend?.(input);
          if ((args.throwOnSend ?? args.sendThrow) !== undefined) throw args.throwOnSend ?? args.sendThrow;
          if (args.sendError !== undefined) return Result.err(args.sendError);
          return Result.ok({
            chatId: args.id,
            conversationId: input.conversationId,
            messageId: `${args.id}-message`,
            text: input.text,
            format: input.format,
            adapterData: {},
          });
        },
        async sendAction(input) {
          args.onSendAction?.(input);
          if (args.sendActionThrow !== undefined) throw args.sendActionThrow;
          if (args.sendActionError !== undefined) return Result.err(args.sendActionError);
          return Result.ok({
            chatId: args.id,
            conversationId: input.conversationId,
            messageId: `${args.id}-action`,
            text: input.text,
            format: input.format,
            adapterData: {},
          });
        },
        async respondToAction(input) {
          args.onRespondToAction?.(input);
          if (args.respondToActionThrow !== undefined) throw args.respondToActionThrow;
          if (args.respondToActionError !== undefined) return Result.err(args.respondToActionError);
          return Result.ok();
        },
        reply: args.nativeReply
          ? async (input) => {
              args.onReply?.(input);
              if ((args.throwOnReply ?? args.replyThrow) !== undefined) throw args.throwOnReply ?? args.replyThrow;
              if (args.replyError !== undefined) return Result.err(args.replyError);
              return Result.ok({
                chatId: args.id,
                conversationId: input.conversationId,
                messageId: `${args.id}-reply`,
                text: input.text,
                format: input.format,
                adapterData: {},
              });
            }
          : undefined,
        sendTyping: args.nativeTyping
          ? async (input) => {
              args.onTyping?.(input);
              if ((args.throwOnTyping ?? args.typingThrow) !== undefined) throw args.throwOnTyping ?? args.typingThrow;
              if (args.typingError !== undefined) return Result.err(args.typingError);
              return Result.ok();
            }
          : undefined,
        ...(args.nativeStream
          ? {
              async streamMessage(input: ChatAdapterStreamMessageInput<TId, Record<never, never>>) {
                args.onStreamMessage?.(input);
                if (args.streamMessageThrow !== undefined) throw args.streamMessageThrow;
                if (args.streamMessageError !== undefined) return Result.err(args.streamMessageError);
                return Result.ok({
                  chatId: args.id,
                  conversationId: input.conversationId,
                  messageId: `${args.id}-stream`,
                  text: "streamed",
                  format: input.content.format,
                  adapterData: {},
                });
              },
              async streamReply(input: ChatAdapterStreamReplyInput<TId, Record<never, never>>) {
                args.onStreamReply?.(input);
                if (args.streamReplyThrow !== undefined) throw args.streamReplyThrow;
                if (args.streamReplyError !== undefined) return Result.err(args.streamReplyError);
                return Result.ok({
                  chatId: args.id,
                  conversationId: input.conversationId,
                  messageId: `${args.id}-stream-reply`,
                  text: "streamed reply",
                  format: input.content.format,
                  adapterData: {},
                });
              },
            }
          : {}),
        async close() {
          handles.closes.push(args.id);
          if (args.closeError !== undefined) throw args.closeError;
        },
      });
    },
  });
}

export const createTestChatAdapter = createRuntimeAdapter;
export type { ChatAttachment };
