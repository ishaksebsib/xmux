import type {
  SlackActionHandler,
  SlackBotClient,
  SlackCommandHandler,
  SlackDownloadFileRequest,
  SlackErrorHandler,
  SlackMessageHandler,
  SlackOpenFileRequest,
  SlackPostEphemeralRequest,
  SlackPostMessageRequest,
  SlackReactionHandler,
  SlackSentMessage,
  SlackUpdateMessageRequest,
} from "../../src/client";

export interface FakeSlackHandlerCounts {
  readonly message: number;
  readonly command: number;
  readonly action: number;
  readonly reactionAdded: number;
  readonly reactionRemoved: number;
  readonly error: number;
}

export interface FakeSlackClientOptions {
  readonly startError?: unknown;
  readonly stopError?: unknown;
}

export interface FakeSlackClient extends SlackBotClient {
  readonly callOrder: string[];
  readonly startCalls: number[];
  readonly stopCalls: number[];
  readonly handlerCountsAtStart: FakeSlackHandlerCounts[];
  readonly postMessageCalls: SlackPostMessageRequest[];
  readonly updateMessageCalls: SlackUpdateMessageRequest[];
  readonly postEphemeralCalls: SlackPostEphemeralRequest[];
  emitError(error: unknown): Promise<void>;
}

export function createFakeSlackClient(options: FakeSlackClientOptions = {}): FakeSlackClient {
  const messageHandlers: SlackMessageHandler[] = [];
  const commandHandlers: SlackCommandHandler[] = [];
  const actionHandlers: SlackActionHandler[] = [];
  const reactionAddedHandlers: SlackReactionHandler[] = [];
  const reactionRemovedHandlers: SlackReactionHandler[] = [];
  const errorHandlers: SlackErrorHandler[] = [];
  const callOrder: string[] = [];
  const startCalls: number[] = [];
  const stopCalls: number[] = [];
  const handlerCountsAtStart: FakeSlackHandlerCounts[] = [];
  const postMessageCalls: SlackPostMessageRequest[] = [];
  const updateMessageCalls: SlackUpdateMessageRequest[] = [];
  const postEphemeralCalls: SlackPostEphemeralRequest[] = [];
  let messageCounter = 1;

  return {
    callOrder,
    startCalls,
    stopCalls,
    handlerCountsAtStart,
    postMessageCalls,
    updateMessageCalls,
    postEphemeralCalls,
    async start() {
      callOrder.push("start");
      startCalls.push(Date.now());
      handlerCountsAtStart.push({
        message: messageHandlers.length,
        command: commandHandlers.length,
        action: actionHandlers.length,
        reactionAdded: reactionAddedHandlers.length,
        reactionRemoved: reactionRemovedHandlers.length,
        error: errorHandlers.length,
      });
      if (options.startError !== undefined) {
        throw options.startError;
      }
    },
    async stop() {
      callOrder.push("stop");
      stopCalls.push(Date.now());
      if (options.stopError !== undefined) {
        throw options.stopError;
      }
    },
    onMessage(handler) {
      callOrder.push("onMessage");
      messageHandlers.push(handler);
    },
    onCommand(handler) {
      callOrder.push("onCommand");
      commandHandlers.push(handler);
    },
    onAction(handler) {
      callOrder.push("onAction");
      actionHandlers.push(handler);
    },
    onReactionAdded(handler) {
      callOrder.push("onReactionAdded");
      reactionAddedHandlers.push(handler);
    },
    onReactionRemoved(handler) {
      callOrder.push("onReactionRemoved");
      reactionRemovedHandlers.push(handler);
    },
    onError(handler) {
      callOrder.push("onError");
      errorHandlers.push(handler);
    },
    async postMessage(input) {
      postMessageCalls.push(input);
      return createSentMessage(input.channel, `${messageCounter++}.000000`, input.thread_ts, input);
    },
    async updateMessage(input) {
      updateMessageCalls.push(input);
      return createSentMessage(input.channel, input.ts, undefined, input);
    },
    async postEphemeral(input) {
      postEphemeralCalls.push(input);
      return createSentMessage(input.channel, `${messageCounter++}.000000`, input.thread_ts, input);
    },
    async openFile(input: SlackOpenFileRequest) {
      return { ok: true, file: { id: input.fileId } };
    },
    async downloadFile(_input: SlackDownloadFileRequest) {
      return new Response(new Uint8Array());
    },
    async emitError(error: unknown) {
      await Promise.all(errorHandlers.map((handler) => handler(error)));
    },
  };
}

function createSentMessage(
  channelId: string,
  messageTs: string,
  threadTs: string | undefined,
  raw: unknown,
): SlackSentMessage {
  return {
    channelId,
    messageTs,
    threadTs,
    teamId: "T123",
    raw,
  };
}
