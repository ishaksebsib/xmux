import type {
  DiscordBotClient,
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
  readonly typingRequests: DiscordSendTypingRequest[];
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
    typingRequests: [],
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
      return sentMessage(input.channelId, `sent-${fake.sentMessages.length}`, input);
    },
    async editMessage(input) {
      fake.editedMessages.push(input);
      return sentMessage(input.channelId, input.messageId, input);
    },
    async createMessageThread(input) {
      return {
        channelId: `thread-${input.messageId}`,
        parentChannelId: input.channelId,
        raw: input,
      } satisfies DiscordThreadInfo;
    },
    async sendTyping(input) {
      fake.typingRequests.push(input);
    },
    async registerCommands(input) {
      fake.callOrder.push("registerCommands");
      fake.registeredCommands.push(input);
    },
    async downloadAttachment(input) {
      fake.downloadedAttachments.push(input);
      return new Response("ok");
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
