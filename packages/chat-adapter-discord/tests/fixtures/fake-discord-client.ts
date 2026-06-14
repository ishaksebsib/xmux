import type {
  DiscordBotClient,
  DiscordCreateThreadRequest,
  DiscordDeleteMessageRequest,
  DiscordDownloadAttachmentRequest,
  DiscordEditMessageRequest,
  DiscordInteractionHandler,
  DiscordMessageHandler,
  DiscordReactionHandler,
  DiscordReadyInfo,
  DiscordRegisterCommandsRequest,
  DiscordSendMessageRequest,
  DiscordSendTypingRequest,
  DiscordSentMessage,
  DiscordThreadInfo,
} from "../../src/client";
import type { DiscordBotToken } from "../../src/config";

export interface FakeDiscordBotClient extends DiscordBotClient {
  readonly callOrder: string[];
  readonly loginCalls: DiscordBotToken[];
  readonly sentMessages: DiscordSendMessageRequest[];
  readonly editedMessages: DiscordEditMessageRequest[];
  readonly deletedMessages: DiscordDeleteMessageRequest[];
  readonly typingRequests: DiscordSendTypingRequest[];
  readonly threadRequests: DiscordCreateThreadRequest[];
  readonly registeredCommands: DiscordRegisterCommandsRequest[];
  readonly downloadedAttachments: DiscordDownloadAttachmentRequest[];
  readonly handlerCountsAtLogin: HandlerCounts[];
  readonly destroyCount: number;
  emitReady(info?: Partial<DiscordReadyInfo>): void;
  emitError(error: unknown): void;
  emitMessage(message?: unknown): void;
  emitInteraction(interaction?: unknown): void;
  emitReactionAdd(reaction?: unknown, user?: unknown): void;
  emitReactionRemove(reaction?: unknown, user?: unknown): void;
}

export interface HandlerCounts {
  readonly ready: number;
  readonly error: number;
  readonly messageCreate: number;
  readonly interactionCreate: number;
  readonly reactionAdd: number;
  readonly reactionRemove: number;
}

export function createFakeDiscordClient(
  options: {
    readonly loginError?: unknown;
    readonly sendMessageError?: unknown;
    readonly sendTypingError?: unknown;
    readonly editMessageError?: unknown;
    readonly deleteMessageError?: unknown;
    readonly createThreadError?: unknown;
    readonly registerCommandsError?: unknown;
    readonly existingThreads?: Readonly<Record<string, string>>;
    readonly attachmentResponses?: Readonly<Record<string, Response>>;
    readonly downloadAttachmentError?: unknown;
  } = {},
): FakeDiscordBotClient {
  const readyHandlers: ((info: DiscordReadyInfo) => void)[] = [];
  const errorHandlers: ((error: unknown) => void)[] = [];
  const messageHandlers: DiscordMessageHandler[] = [];
  const interactionHandlers: DiscordInteractionHandler[] = [];
  const reactionAddHandlers: DiscordReactionHandler[] = [];
  const reactionRemoveHandlers: DiscordReactionHandler[] = [];

  let destroyCount = 0;

  const fake: FakeDiscordBotClient = {
    callOrder: [],
    loginCalls: [],
    sentMessages: [],
    editedMessages: [],
    deletedMessages: [],
    typingRequests: [],
    threadRequests: [],
    registeredCommands: [],
    downloadedAttachments: [],
    handlerCountsAtLogin: [],
    get destroyCount() {
      return destroyCount;
    },
    async login(token) {
      fake.callOrder.push("login");
      fake.loginCalls.push(token);
      fake.handlerCountsAtLogin.push(handlerCounts());
      if (options.loginError !== undefined) {
        throw options.loginError;
      }
    },
    destroy() {
      fake.callOrder.push("destroy");
      destroyCount += 1;
    },
    getBotUserId: () => "bot-user-id",
    onReady(handler) {
      fake.callOrder.push("onReady");
      readyHandlers.push(handler);
    },
    onError(handler) {
      fake.callOrder.push("onError");
      errorHandlers.push(handler);
    },
    onMessageCreate(handler) {
      fake.callOrder.push("onMessageCreate");
      messageHandlers.push(handler);
    },
    onInteractionCreate(handler) {
      fake.callOrder.push("onInteractionCreate");
      interactionHandlers.push(handler);
    },
    onReactionAdd(handler) {
      fake.callOrder.push("onReactionAdd");
      reactionAddHandlers.push(handler);
    },
    onReactionRemove(handler) {
      fake.callOrder.push("onReactionRemove");
      reactionRemoveHandlers.push(handler);
    },
    async sendMessage(input) {
      fake.sentMessages.push(input);
      if (options.sendMessageError !== undefined) {
        throw options.sendMessageError;
      }
      return sentMessage(input.channelId, `sent-${fake.sentMessages.length}`, input);
    },
    async editMessage(input) {
      fake.editedMessages.push(input);
      if (options.editMessageError !== undefined) {
        throw options.editMessageError;
      }
      return sentMessage(input.channelId, input.messageId, input);
    },
    async deleteMessage(input) {
      fake.deletedMessages.push(input);
      if (options.deleteMessageError !== undefined) {
        throw options.deleteMessageError;
      }
    },
    async createMessageThread(input) {
      const existingThreadId = options.existingThreads?.[input.messageId];
      if (existingThreadId !== undefined) {
        return {
          channelId: existingThreadId,
          parentChannelId: input.channelId,
          raw: { reused: true, input },
        } satisfies DiscordThreadInfo;
      }

      fake.threadRequests.push(input);
      if (options.createThreadError !== undefined) {
        throw options.createThreadError;
      }
      return {
        channelId: `thread-${input.messageId}`,
        parentChannelId: input.channelId,
        raw: input,
      } satisfies DiscordThreadInfo;
    },
    async sendTyping(input) {
      fake.typingRequests.push(input);
      if (options.sendTypingError !== undefined) {
        throw options.sendTypingError;
      }
    },
    async registerCommands(input) {
      fake.callOrder.push("registerCommands");
      fake.registeredCommands.push(input);
      if (options.registerCommandsError !== undefined) {
        throw options.registerCommandsError;
      }
    },
    async downloadAttachment(input) {
      fake.downloadedAttachments.push(input);
      if (options.downloadAttachmentError !== undefined) {
        throw options.downloadAttachmentError;
      }
      return options.attachmentResponses?.[input.url] ?? new Response("ok");
    },
    emitReady(info = {}) {
      const ready = { userId: "bot-user-id", username: "bot", ...info };
      for (const handler of readyHandlers) handler(ready);
    },
    emitError(error) {
      for (const handler of errorHandlers) handler(error);
    },
    emitMessage(message = {}) {
      for (const handler of messageHandlers) void handler(message as never);
    },
    emitInteraction(interaction = {}) {
      for (const handler of interactionHandlers) void handler(interaction as never);
    },
    emitReactionAdd(reaction = {}, user = {}) {
      for (const handler of reactionAddHandlers) void handler(reaction as never, user as never);
    },
    emitReactionRemove(reaction = {}, user = {}) {
      for (const handler of reactionRemoveHandlers) void handler(reaction as never, user as never);
    },
  };

  function handlerCounts(): HandlerCounts {
    return {
      ready: readyHandlers.length,
      error: errorHandlers.length,
      messageCreate: messageHandlers.length,
      interactionCreate: interactionHandlers.length,
      reactionAdd: reactionAddHandlers.length,
      reactionRemove: reactionRemoveHandlers.length,
    };
  }

  return fake;
}

function sentMessage(channelId: string, messageId: string, raw: unknown): DiscordSentMessage {
  return { channelId, messageId, raw };
}
