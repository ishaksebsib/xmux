import type {
  SlackActionEvent,
  SlackActionHandler,
  SlackAppMentionEvent,
  SlackAppMentionHandler,
  SlackBotClient,
  SlackBotIdentity,
  SlackCommandEvent,
  SlackCommandHandler,
  SlackDownloadFileRequest,
  SlackErrorHandler,
  SlackMessageEvent,
  SlackMessageHandler,
  SlackOpenFileRequest,
  SlackPostEphemeralRequest,
  SlackPostMessageRequest,
  SlackReactionEvent,
  SlackReactionHandler,
  SlackSentMessage,
  SlackAppendStreamRequest,
  SlackStartStreamRequest,
  SlackStopStreamRequest,
  SlackUpdateMessageRequest,
} from "../../src/client";

export interface FakeSlackHandlerCounts {
  readonly message: number;
  readonly appMention: number;
  readonly command: number;
  readonly action: number;
  readonly reactionAdded: number;
  readonly reactionRemoved: number;
  readonly error: number;
}

export interface FakeSlackClientOptions {
  readonly startError?: unknown;
  readonly stopError?: unknown;
  readonly postMessageError?: unknown;
  readonly updateMessageError?: unknown;
  readonly postEphemeralError?: unknown;
  readonly startStreamError?: unknown;
  readonly appendStreamError?: unknown;
  readonly stopStreamError?: unknown;
  readonly botIdentity?: SlackBotIdentity;
  readonly downloadFile?: (input: SlackDownloadFileRequest) => Promise<Response>;
}

export interface FakeSlackClient extends SlackBotClient {
  readonly callOrder: string[];
  readonly startCalls: number[];
  readonly stopCalls: number[];
  readonly handlerCountsAtStart: FakeSlackHandlerCounts[];
  readonly postMessageCalls: SlackPostMessageRequest[];
  readonly updateMessageCalls: SlackUpdateMessageRequest[];
  readonly postEphemeralCalls: SlackPostEphemeralRequest[];
  readonly startStreamCalls: SlackStartStreamRequest[];
  readonly appendStreamCalls: SlackAppendStreamRequest[];
  readonly stopStreamCalls: SlackStopStreamRequest[];
  emitMessage(
    event: SlackMessageEvent["event"],
    options?: Pick<SlackMessageEvent, "retryNum" | "retryReason">,
  ): Promise<void>;
  emitAppMention(
    event: SlackAppMentionEvent["event"],
    options?: Pick<SlackAppMentionEvent, "retryNum" | "retryReason">,
  ): Promise<void>;
  emitAction(
    action: SlackActionEvent["action"],
    body: SlackActionEvent["body"],
    options?: { readonly ack?: () => Promise<void> } & Pick<
      SlackActionEvent,
      "retryNum" | "retryReason"
    >,
  ): Promise<void>;
  emitCommand(
    payload: SlackCommandEvent["payload"],
    options?: { readonly ack?: () => Promise<void> } & Pick<
      SlackCommandEvent,
      "retryNum" | "retryReason"
    >,
  ): Promise<void>;
  emitReactionAdded(
    event: SlackReactionEvent["event"],
    options?: Pick<SlackReactionEvent, "retryNum" | "retryReason">,
  ): Promise<void>;
  emitReactionRemoved(
    event: SlackReactionEvent["event"],
    options?: Pick<SlackReactionEvent, "retryNum" | "retryReason">,
  ): Promise<void>;
  emitError(error: unknown): Promise<void>;
}

export function createFakeSlackClient(options: FakeSlackClientOptions = {}): FakeSlackClient {
  const messageHandlers: SlackMessageHandler[] = [];
  const appMentionHandlers: SlackAppMentionHandler[] = [];
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
  const startStreamCalls: SlackStartStreamRequest[] = [];
  const appendStreamCalls: SlackAppendStreamRequest[] = [];
  const stopStreamCalls: SlackStopStreamRequest[] = [];
  let messageCounter = 1;

  return {
    callOrder,
    startCalls,
    stopCalls,
    handlerCountsAtStart,
    postMessageCalls,
    updateMessageCalls,
    postEphemeralCalls,
    startStreamCalls,
    appendStreamCalls,
    stopStreamCalls,
    async start() {
      callOrder.push("start");
      startCalls.push(Date.now());
      handlerCountsAtStart.push({
        message: messageHandlers.length,
        appMention: appMentionHandlers.length,
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
    onAppMention(handler) {
      callOrder.push("onAppMention");
      appMentionHandlers.push(handler);
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
      if (options.postMessageError !== undefined) {
        throw options.postMessageError;
      }
      return createSentMessage(input.channel, `${messageCounter++}.000000`, input.thread_ts, input);
    },
    async updateMessage(input) {
      updateMessageCalls.push(input);
      if (options.updateMessageError !== undefined) {
        throw options.updateMessageError;
      }
      return createSentMessage(input.channel, input.ts, undefined, input);
    },
    async postEphemeral(input) {
      postEphemeralCalls.push(input);
      if (options.postEphemeralError !== undefined) {
        throw options.postEphemeralError;
      }
      return createSentMessage(input.channel, `${messageCounter++}.000000`, input.thread_ts, input);
    },
    async startStream(input) {
      startStreamCalls.push(input);
      if (options.startStreamError !== undefined) {
        throw options.startStreamError;
      }
      return createSentMessage(input.channel, `${messageCounter++}.000000`, input.thread_ts, input);
    },
    async appendStream(input) {
      appendStreamCalls.push(input);
      if (options.appendStreamError !== undefined) {
        throw options.appendStreamError;
      }
      return createSentMessage(input.channel, input.ts, undefined, input);
    },
    async stopStream(input) {
      stopStreamCalls.push(input);
      if (options.stopStreamError !== undefined) {
        throw options.stopStreamError;
      }
      return createSentMessage(input.channel, input.ts, input.thread_ts, input);
    },
    async openFile(input: SlackOpenFileRequest) {
      return { ok: true, file: { id: input.fileId } };
    },
    async downloadFile(input: SlackDownloadFileRequest) {
      return options.downloadFile?.(input) ?? new Response(new Uint8Array());
    },
    async getBotIdentity() {
      return options.botIdentity ?? { botUserId: "U_BOT", botId: "B_BOT", teamId: "T123", raw: {} };
    },
    async emitMessage(event, emitOptions = {}) {
      const messageEvent = createMessageEvent(event, emitOptions);
      await Promise.all(messageHandlers.map((handler) => handler(messageEvent)));
    },
    async emitAppMention(event, emitOptions = {}) {
      const appMentionEvent = createAppMentionEvent(event, emitOptions);
      await Promise.all(appMentionHandlers.map((handler) => handler(appMentionEvent)));
    },
    async emitAction(action, body, emitOptions = {}) {
      const event = createActionEvent(action, body, emitOptions);
      await Promise.all(actionHandlers.map((handler) => handler(event)));
    },
    async emitCommand(payload, emitOptions = {}) {
      const event = createCommandEvent(payload, emitOptions);
      await Promise.all(commandHandlers.map((handler) => handler(event)));
    },
    async emitReactionAdded(event, emitOptions = {}) {
      const reactionEvent = createReactionEvent(event, emitOptions);
      await Promise.all(reactionAddedHandlers.map((handler) => handler(reactionEvent)));
    },
    async emitReactionRemoved(event, emitOptions = {}) {
      const reactionEvent = createReactionEvent(event, emitOptions);
      await Promise.all(reactionRemovedHandlers.map((handler) => handler(reactionEvent)));
    },
    async emitError(error: unknown) {
      await Promise.all(errorHandlers.map((handler) => handler(error)));
    },
  };
}

function createMessageEvent(
  event: SlackMessageEvent["event"],
  options: Pick<SlackMessageEvent, "retryNum" | "retryReason">,
): SlackMessageEvent {
  return {
    event,
    body: {} as SlackMessageEvent["body"],
    raw: {} as SlackMessageEvent["raw"],
    ...options,
  };
}

function createAppMentionEvent(
  event: SlackAppMentionEvent["event"],
  options: Pick<SlackAppMentionEvent, "retryNum" | "retryReason">,
): SlackAppMentionEvent {
  return {
    event,
    body: {} as SlackAppMentionEvent["body"],
    raw: {} as SlackAppMentionEvent["raw"],
    ...options,
  };
}

function createActionEvent(
  action: SlackActionEvent["action"],
  body: SlackActionEvent["body"],
  options: { readonly ack?: () => Promise<void> } & Pick<
    SlackActionEvent,
    "retryNum" | "retryReason"
  >,
): SlackActionEvent {
  return {
    payload: action,
    action,
    body,
    ack: options.ack ?? (async () => undefined),
    respond: (async () => undefined) as SlackActionEvent["respond"],
    raw: {} as SlackActionEvent["raw"],
    retryNum: options.retryNum,
    retryReason: options.retryReason,
  };
}

function createCommandEvent(
  payload: SlackCommandEvent["payload"],
  options: { readonly ack?: () => Promise<void> } & Pick<
    SlackCommandEvent,
    "retryNum" | "retryReason"
  >,
): SlackCommandEvent {
  return {
    payload,
    ack: options.ack ?? (async () => undefined),
    respond: (async () => undefined) as SlackCommandEvent["respond"],
    raw: {} as SlackCommandEvent["raw"],
    retryNum: options.retryNum,
    retryReason: options.retryReason,
  };
}

function createReactionEvent(
  event: SlackReactionEvent["event"],
  options: Pick<SlackReactionEvent, "retryNum" | "retryReason">,
): SlackReactionEvent {
  return {
    event,
    body: {} as SlackReactionEvent["body"],
    raw: {} as SlackReactionEvent["raw"],
    ...options,
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
