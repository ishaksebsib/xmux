import { Result } from "better-result";
import { describe, expect, test } from "vitest";
import { defineChatAdapter } from "@xmux/chat-core";
import {
  defineHarnessAdapter,
  type HarnessModelInfo,
  type HarnessModelRef,
  type HarnessSelectedModel,
  type HarnessThinkingLevel,
  type HarnessThinkingTarget,
} from "@xmux/harness-core";
import { createXmux } from "../src";
import { createSessionRecord, createThreadBinding } from "../src/store";

const capabilities = {
  messages: {
    send: true,
    reply: true,
    edit: false,
    delete: false,
    typing: false,
    markdown: true,
    attachments: { receive: false, send: false, download: false },
  },
} as const;

const thread = { chatId: "telegram", threadId: "conversation-1" } as const;
const sessionRef = { harnessId: "opencode", sessionId: "session-1" } as const;
const models = [
  {
    harnessId: "opencode",
    ref: { providerId: "openai", modelId: "gpt-4.1" },
    name: "GPT-4.1",
    providerName: "OpenAI",
    adapterData: {},
  },
  {
    harnessId: "opencode",
    ref: { providerId: "anthropic", modelId: "claude-3-7-sonnet" },
    name: "Claude 3.7 Sonnet",
    providerName: "Anthropic",
    adapterData: {},
  },
] satisfies readonly HarnessModelInfo<"opencode">[];

describe("/model command", () => {
  test("replies when no active session is bound to the thread", async () => {
    const { emitCommand, replies, listInputs, xmux } = await initializeXmux();

    emitCommand(commandEvent({ selector: undefined }));

    await eventually(() => replies.length === 1);

    expect(listInputs).toHaveLength(0);
    expect(replies[0]).toBe(
      "**No active session**\n\nCreate or resume a session before changing models.\n\nUse `/new <harnessId>` or `/resume` to continue.",
    );

    await xmux.shutdown();
  });

  test("shows provider buttons, lists provider models, and updates selected model", async () => {
    const {
      emitCommand,
      emitAction,
      replies,
      sentActions,
      actionResponses,
      listInputs,
      getInputs,
      setInputs,
      xmux,
    } = await initializeXmux();
    await bindSession({ xmux });

    emitCommand(commandEvent({ selector: undefined }));

    await eventually(() => sentActions.length === 1);

    expect(replies).toHaveLength(0);
    expect(listInputs).toEqual([{ harnessId: "opencode", cwd: process.cwd() }]);
    expect(getInputs).toEqual([{ target: { type: "session", ref: sessionRef } }]);
    expect(sentActions[0]?.text).toContain("**Model: `openai/gpt-4.1`**");
    expect(sentActions[0]?.text).toContain("- Harness: `opencode`");
    expect(sentActions[0]?.text).toContain("- Session ID: `session-1`");
    expect(sentActions[0]?.text).toContain("- Model: `openai/gpt-4.1`");
    expect(sentActions[0]?.text).not.toContain("- Thinking Level:");
    expect(sentActions[0]?.text).not.toContain("**Available models**");
    expect(sentActions[0]?.buttons).toEqual([
      [
        expect.objectContaining({
          id: "model-provider-0",
          label: "OpenAI",
          actionId: "model",
          value: "p",
          payload: "0",
        }),
      ],
      [
        expect.objectContaining({
          id: "model-provider-1",
          label: "Anthropic",
          actionId: "model",
          value: "p",
          payload: "1",
        }),
      ],
    ]);

    emitAction(actionEvent({ value: "p", payload: "1" }));

    await eventually(() => actionResponses.length === 2);

    expect(listInputs).toEqual([
      { harnessId: "opencode", cwd: process.cwd() },
      { harnessId: "opencode", cwd: process.cwd() },
    ]);
    expect(getInputs).toEqual([
      { target: { type: "session", ref: sessionRef } },
      { target: { type: "session", ref: sessionRef } },
    ]);
    expect(actionResponses[0]?.response.kind).toBe("ack");
    expect(actionResponses[1]?.response.kind).toBe("update");
    const providerMessage = actionResponseText(actionResponses[1]?.response.message);
    expect(providerMessage).toContain("**Anthropic models** (1/1)");
    expect(providerMessage).toContain("- Model: `openai/gpt-4.1`");
    expect(providerMessage).not.toContain("- Thinking Level:");
    expect(providerMessage).not.toContain("- Claude 3\\.7 Sonnet");
    expect(actionResponses[1]?.response.buttons).toEqual([
      [
        expect.objectContaining({
          id: "model-option-1-0",
          label: "Claude 3.7 Sonnet",
          actionId: "model",
          value: "m",
          payload: "1:0",
        }),
      ],
    ]);

    emitAction(actionEvent({ value: "m", payload: "1:0" }));

    await eventually(() => actionResponses.length === 4);

    expect(setInputs).toEqual([
      {
        target: { type: "session", ref: sessionRef },
        update: {
          type: "set",
          model: { providerId: "anthropic", modelId: "claude-3-7-sonnet" },
        },
      },
    ]);
    expect(actionResponses[2]?.response.kind).toBe("ack");
    expect(actionResponses[3]?.response.kind).toBe("update");
    const updatedMessage = actionResponseText(actionResponses[3]?.response.message);
    expect(updatedMessage).toBe(
      "**Model updated**\n\n- Model: `anthropic/claude-3-7-sonnet`\n- Harness: `opencode`\n- Session ID: `session-1`\n\nThis model is now selected for the current session.",
    );
    expect(actionResponses[3]?.response.buttons).toEqual([]);

    await xmux.shutdown();
  });

  test("asks for thinking level before setting models with configurable thinking", async () => {
    const thinkingModel = {
      harnessId: "opencode",
      ref: { providerId: "openai", modelId: "gpt-5" },
      name: "GPT-5",
      providerName: "OpenAI",
      capabilities: {
        thinking: { supportedLevels: ["off", "low", "medium", "high"], defaultLevel: "medium" },
      },
      adapterData: {},
    } satisfies HarnessModelInfo<"opencode">;
    const {
      emitCommand,
      emitAction,
      sentActions,
      actionResponses,
      setInputs,
      setThinkingInputs,
      xmux,
    } = await initializeXmux({ models: [thinkingModel] });
    await bindSession({ xmux });

    emitCommand(commandEvent({ selector: undefined }));
    await eventually(() => sentActions.length === 1);

    emitAction(actionEvent({ value: "p", payload: "0" }));
    await eventually(() => actionResponses.length === 2);

    emitAction(actionEvent({ value: "m", payload: "0:0" }));
    await eventually(() => actionResponses.length === 4);

    expect(setInputs).toHaveLength(0);
    expect(actionResponses[3]?.response.kind).toBe("update");
    const thinkingMessage = actionResponseText(actionResponses[3]?.response.message);
    expect(thinkingMessage).toContain("**Choose thinking level**");
    expect(thinkingMessage).toContain("- Model: `openai/gpt-5`");
    expect(thinkingMessage).toContain("- Thinking Level: `medium`");
    expect(actionResponses[3]?.response.buttons).toEqual([
      [expect.objectContaining({ label: "Off", value: "t", payload: "0:0:off" })],
      [expect.objectContaining({ label: "Low", value: "t", payload: "0:0:low" })],
      [
        expect.objectContaining({
          label: "Medium",
          value: "t",
          payload: "0:0:medium",
          style: "primary",
        }),
      ],
      [expect.objectContaining({ label: "High", value: "t", payload: "0:0:high" })],
    ]);

    emitAction(actionEvent({ value: "t", payload: "0:0:high" }));
    await eventually(() => actionResponses.length === 6);

    expect(setInputs).toEqual([
      {
        target: { type: "session", ref: sessionRef },
        update: {
          type: "set",
          model: { providerId: "openai", modelId: "gpt-5" },
        },
      },
    ]);
    expect(setThinkingInputs).toEqual([
      {
        target: { type: "session", ref: sessionRef },
        update: { type: "set", level: "high" },
      },
    ]);
    const updatedThinkingMessage = actionResponseText(actionResponses[5]?.response.message);
    expect(updatedThinkingMessage).toContain("- Model: `openai/gpt-5`");
    expect(updatedThinkingMessage).toContain("- Thinking Level: `high`");
    expect(actionResponses[5]?.response.buttons).toEqual([]);

    await xmux.shutdown();
  });

  test("disables carried thinking before selecting a model without configurable thinking", async () => {
    const thinkingModel = {
      harnessId: "opencode",
      ref: { providerId: "openai", modelId: "gpt-5" },
      name: "GPT-5",
      providerName: "OpenAI",
      capabilities: {
        thinking: { supportedLevels: ["off", "low", "medium", "high"], defaultLevel: "medium" },
      },
      adapterData: {},
    } satisfies HarnessModelInfo<"opencode">;
    const nonThinkingModel = {
      harnessId: "opencode",
      ref: { providerId: "opencode", modelId: "big-pickle" },
      name: "Big Pickle",
      providerName: "OpenCode",
      capabilities: {
        thinking: { supportedLevels: ["off"], defaultLevel: "off" },
      },
      adapterData: {},
    } satisfies HarnessModelInfo<"opencode">;
    const {
      emitCommand,
      emitAction,
      sentActions,
      actionResponses,
      setInputs,
      setThinkingInputs,
      xmux,
    } = await initializeXmux({
      models: [thinkingModel, nonThinkingModel],
      initialModel: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      initialThinkingLevel: "medium",
    });
    await bindSession({ xmux });

    emitCommand(commandEvent({ selector: undefined }));
    await eventually(() => sentActions.length === 1);

    emitAction(actionEvent({ value: "p", payload: "1" }));
    await eventually(() => actionResponses.length === 2);

    emitAction(actionEvent({ value: "m", payload: "1:0" }));
    await eventually(() => actionResponses.length === 4);

    expect(setThinkingInputs).toEqual([
      {
        target: { type: "session", ref: sessionRef },
        update: { type: "set", level: "off" },
      },
    ]);
    expect(setInputs).toEqual([
      {
        target: { type: "session", ref: sessionRef },
        update: {
          type: "set",
          model: { providerId: "opencode", modelId: "big-pickle" },
        },
      },
    ]);
    const updatedMessage = actionResponseText(actionResponses[3]?.response.message);
    expect(updatedMessage).toContain("- Model: `opencode/big-pickle`");
    expect(updatedMessage).not.toContain("- Thinking Level:");
    expect(updatedMessage).not.toContain("@medium");

    await xmux.shutdown();
  });

  test("limits listed models per provider using the default model config", async () => {
    const { emitCommand, emitAction, sentActions, actionResponses, xmux } = await initializeXmux({
      models: [
        ...createProviderModels({ providerId: "openai", providerName: "OpenAI", count: 11 }),
        ...createProviderModels({ providerId: "google", providerName: "Google", count: 2 }),
      ],
    });
    await bindSession({ xmux });

    emitCommand(commandEvent({ selector: undefined }));
    await eventually(() => sentActions.length === 1);
    emitAction(actionEvent({ value: "p", payload: "0" }));

    await eventually(() => actionResponses.length === 2);

    const providerMessage = actionResponseText(actionResponses[1]?.response.message);
    expect(providerMessage).toContain("**OpenAI models** (10/11)");
    expect(providerMessage).not.toContain("- OpenAI Model 10");
    expect(providerMessage).not.toContain("- OpenAI Model 11");
    const modelButtons = actionResponses[1]?.response.buttons as
      | readonly (readonly unknown[])[]
      | undefined;
    expect(modelButtons).toHaveLength(2);
    expect(modelButtons?.map((row) => row.length)).toEqual([5, 5]);

    await xmux.shutdown();
  });

  test("uses configured max models per provider", async () => {
    const { emitCommand, emitAction, sentActions, actionResponses, xmux } = await initializeXmux({
      maxModelsPerProvider: 2,
      models: createProviderModels({ providerId: "openai", providerName: "OpenAI", count: 4 }),
    });
    await bindSession({ xmux });

    emitCommand(commandEvent({ selector: undefined }));
    await eventually(() => sentActions.length === 1);
    emitAction(actionEvent({ value: "p", payload: "0" }));

    await eventually(() => actionResponses.length === 2);

    const providerMessage = actionResponseText(actionResponses[1]?.response.message);
    expect(providerMessage).toContain("**OpenAI models** (2/4)");
    expect(providerMessage).not.toContain("- OpenAI Model 2");
    expect(providerMessage).not.toContain("- OpenAI Model 3");
    expect(actionResponses[1]?.response.buttons).toHaveLength(2);

    await xmux.shutdown();
  });

  test("sets a selected model for the active session", async () => {
    const { emitCommand, replies, setInputs, xmux } = await initializeXmux();
    await bindSession({ xmux });

    emitCommand(commandEvent({ selector: "anthropic/claude-3-7-sonnet" }));

    await eventually(() => replies.length === 1);

    expect(setInputs).toEqual([
      {
        target: { type: "session", ref: sessionRef },
        update: {
          type: "set",
          model: { providerId: "anthropic", modelId: "claude-3-7-sonnet" },
        },
      },
    ]);
    expect(replies[0]).toBe(
      "**Model updated**\n\n- Model: `anthropic/claude-3-7-sonnet`\n- Harness: `opencode`\n- Session ID: `session-1`\n\nThis model is now selected for the current session.",
    );
    expect(replies[0]).not.toContain("**Available models**");

    await xmux.shutdown();
  });

  test("does not set an unknown model selector and suggests available models", async () => {
    const { emitCommand, replies, setInputs, xmux } = await initializeXmux();
    await bindSession({ xmux });

    emitCommand(commandEvent({ selector: "openai/missing" }));

    await eventually(() => replies.length === 1);

    expect(setInputs).toHaveLength(0);
    expect(replies[0]).toContain("**Model not found**");
    expect(replies[0]).toContain("Selector: `openai/missing`");
    expect(replies[0]).toContain("- `openai/gpt-4.1`");
    expect(replies[0]).toContain("- `anthropic/claude-3-7-sonnet`");

    await xmux.shutdown();
  });

  test("reports provider-less ambiguous selectors", async () => {
    const { emitCommand, replies, setInputs, xmux } = await initializeXmux({
      models: [
        ...models,
        {
          harnessId: "opencode",
          ref: { providerId: "azure", modelId: "gpt-4.1" },
          name: "GPT-4.1 Azure",
          providerName: "Azure",
          adapterData: {},
        },
      ],
    });
    await bindSession({ xmux });

    emitCommand(commandEvent({ selector: "gpt-4.1" }));

    await eventually(() => replies.length === 1);

    expect(setInputs).toHaveLength(0);
    expect(replies[0]).toContain("**Model selector is ambiguous**");
    expect(replies[0]).toContain("Selector: `gpt-4.1`");
    expect(replies[0]).toContain("- `openai/gpt-4.1`");
    expect(replies[0]).toContain("- `azure/gpt-4.1`");

    await xmux.shutdown();
  });

  test("formats unsupported model management errors", async () => {
    const { emitCommand, replies, xmux } = await initializeXmux({ supportModels: false });
    await bindSession({ xmux });

    emitCommand(commandEvent({ selector: undefined }));

    await eventually(() => replies.length === 1);

    expect(replies[0]).toBe(
      "**Model management unsupported**\n\nHarness `opencode` does not support model management yet.",
    );

    await xmux.shutdown();
  });

  test("reports closed active sessions", async () => {
    const { emitCommand, replies, listInputs, xmux } = await initializeXmux();
    await bindSession({ xmux, status: "closed" });

    emitCommand(commandEvent({ selector: undefined }));

    await eventually(() => replies.length === 1);

    expect(listInputs).toHaveLength(0);
    expect(replies[0]).toBe(
      "**Session is closed**\n\nStart a new session with `/new <harnessId>`.",
    );

    await xmux.shutdown();
  });
});

interface InitializeXmuxInput {
  readonly models?: readonly HarnessModelInfo<"opencode">[];
  readonly maxModelsPerProvider?: number;
  readonly supportModels?: boolean;
  readonly initialModel?: HarnessModelRef;
  readonly initialThinkingLevel?: HarnessThinkingLevel;
}

async function initializeXmux(input: InitializeXmuxInput = {}) {
  const replies: string[] = [];
  const sentActions: {
    readonly text: string;
    readonly format?: "plain" | "markdown" | "html";
    readonly buttons: readonly (readonly {
      readonly id: string;
      readonly label: string;
      readonly actionId?: string;
      readonly value?: string;
      readonly payload?: unknown;
    }[])[];
  }[] = [];
  const actionResponses: {
    readonly interactionId: string;
    readonly response: {
      readonly kind: string;
      readonly message?: unknown;
      readonly buttons?: unknown;
    };
  }[] = [];
  const listInputs: { readonly harnessId: string; readonly cwd?: string }[] = [];
  const getInputs: { readonly target: HarnessSelectedModel["target"] }[] = [];
  const setInputs: {
    readonly target: HarnessSelectedModel["target"];
    readonly update: { readonly type: "set"; readonly model: HarnessModelRef };
  }[] = [];
  const setThinkingInputs: {
    readonly target: HarnessThinkingTarget<"opencode">;
    readonly update: { readonly type: "set"; readonly level: HarnessThinkingLevel };
  }[] = [];
  let selectedModel: HarnessModelRef = input.initialModel ?? {
    providerId: "openai",
    modelId: "gpt-4.1",
  };
  let selectedThinkingLevel: HarnessThinkingLevel | undefined = input.initialThinkingLevel;
  let emitEvent: ((event: unknown) => void) | undefined;

  const xmux = createXmux({
    harnesses: {
      opencode: defineHarnessAdapter<"opencode">({
        id: "opencode",
        async open() {
          const runtime = {
            id: "opencode" as const,
            async createSession() {
              return Result.err(new Error("not implemented"));
            },
            async resumeSession() {
              return Result.err(new Error("not implemented"));
            },
            async listSessions() {
              return Result.err(new Error("not implemented"));
            },
            async getSession() {
              return Result.err(new Error("not implemented"));
            },
            async prompt() {
              return Result.err(new Error("not implemented"));
            },
            async deleteSession() {
              return Result.err(new Error("not implemented"));
            },
            async abort() {
              return Result.err(new Error("not implemented"));
            },
            close: async () => {},
          };

          if (input.supportModels === false) {
            return Result.ok(runtime);
          }

          return Result.ok({
            ...runtime,
            async listModels(listInput: { readonly cwd?: string }) {
              listInputs.push({ harnessId: "opencode", cwd: listInput.cwd });
              return Result.ok(input.models ?? models);
            },
            async getModel(getInput: { readonly target: HarnessSelectedModel["target"] }) {
              getInputs.push({ target: getInput.target });
              return Result.ok({
                target: getInput.target,
                model: selectedModel,
                source: "session" as const,
              });
            },
            async getThinking(getInput: { readonly target: HarnessThinkingTarget<"opencode"> }) {
              return Result.ok({
                target: getInput.target,
                ...(selectedThinkingLevel === undefined ? {} : { level: selectedThinkingLevel }),
                source:
                  selectedThinkingLevel === undefined ? ("unset" as const) : ("session" as const),
              });
            },
            async setModel(setInput: {
              readonly target: HarnessSelectedModel["target"];
              readonly update: { readonly type: "set"; readonly model: HarnessModelRef };
            }) {
              setInputs.push({ target: setInput.target, update: setInput.update });
              selectedModel = setInput.update.model;
              return Result.ok({
                target: setInput.target,
                model: selectedModel,
                source: "session" as const,
              });
            },
            async setThinking(setInput: {
              readonly target: HarnessThinkingTarget<"opencode">;
              readonly update: { readonly type: "set"; readonly level: HarnessThinkingLevel };
            }) {
              setThinkingInputs.push({ target: setInput.target, update: setInput.update });
              selectedThinkingLevel = setInput.update.level;
              selectedModel =
                setInput.update.level === "off"
                  ? { ...selectedModel, variant: undefined }
                  : { ...selectedModel, variant: setInput.update.level };
              return Result.ok({
                target: setInput.target,
                level: setInput.update.level,
                source: "session" as const,
              });
            },
          });
        },
      }),
    },
    chats: {
      telegram: defineChatAdapter<
        "telegram",
        Record<never, never>,
        Record<never, never>,
        typeof capabilities
      >({
        id: "telegram",
        capabilities,
        async open() {
          return Result.ok({
            id: "telegram",
            async start(context) {
              emitEvent = context.emit as (event: unknown) => void;
              return Result.ok();
            },
            async sendMessage(messageInput) {
              return Result.ok(
                sentMessage({ text: messageInput.text, format: messageInput.format }),
              );
            },
            async sendAction(input) {
              sentActions.push({
                text: input.text,
                format: input.format,
                buttons: input.buttons,
              });
              return Result.ok({
                chatId: input.chatId,
                conversationId: input.conversationId,
                messageId: "action-1",
                text: input.text,
                adapterData: {},
              });
            },
            async respondToAction(input) {
              actionResponses.push({
                interactionId: input.interactionId,
                response: input.response,
              });
              return Result.ok();
            },
            async reply(replyInput) {
              replies.push(replyInput.text);
              return Result.ok(sentMessage({ text: replyInput.text, format: replyInput.format }));
            },
            close: async () => {},
          });
        },
      }),
    },
    config: {
      userName: "xmux",
      defaultWorkingDirectory: process.cwd(),
      deliveryMode: "requester_only",
      ...(input.maxModelsPerProvider === undefined
        ? {}
        : { model: { maxModelsPerProvider: input.maxModelsPerProvider } }),
    },
  });

  expect((await xmux.initialize()).isOk()).toBe(true);
  expect(emitEvent).toBeDefined();

  return {
    replies,
    sentActions,
    actionResponses,
    listInputs,
    getInputs,
    setInputs,
    setThinkingInputs,
    emitCommand: emitEvent as (event: unknown) => void,
    emitAction: emitEvent as (event: unknown) => void,
    xmux,
  };
}

function createProviderModels(input: {
  readonly providerId: string;
  readonly providerName: string;
  readonly count: number;
}): readonly HarnessModelInfo<"opencode">[] {
  return Array.from({ length: input.count }, (_, index) => ({
    harnessId: "opencode" as const,
    ref: { providerId: input.providerId, modelId: `model-${index + 1}` },
    name: `${input.providerName} Model ${index + 1}`,
    providerName: input.providerName,
    adapterData: {},
  }));
}

async function bindSession(input: {
  readonly xmux: Awaited<ReturnType<typeof initializeXmux>>["xmux"];
  readonly status?: "open" | "closed";
}) {
  const now = new Date().toISOString();
  const created = await input.xmux.ctx.store.sessions.create(
    createSessionRecord({
      ref: sessionRef,
      origin: thread,
      requester: { userId: "user-1", displayName: "Ishak" },
      cwd: process.cwd(),
      deliveryMode: "requester_only",
      title: "Fix bug",
      now,
    }),
  );
  expect(created.isOk()).toBe(true);

  if (input.status === "closed") {
    const updated = await input.xmux.ctx.store.sessions.update(sessionRef, {
      status: "closed",
      updatedAt: now,
      closedAt: now,
    });
    expect(updated.isOk()).toBe(true);
  }

  const bound = await input.xmux.ctx.store.threadBindings.bind(
    createThreadBinding({ thread, sessionRef, now }),
  );
  expect(bound.isOk()).toBe(true);
}

function commandEvent(input: { readonly selector?: string }) {
  return {
    type: "command",
    chatId: "telegram",
    conversation: { chatId: "telegram", conversationId: thread.threadId },
    actor: { kind: "user", actorId: "user-1", displayName: "Ishak", adapterData: {} },
    message: { chatId: "telegram", conversationId: thread.threadId, messageId: "message-1" },
    command: {
      name: "model",
      options: { selector: input.selector },
    },
  };
}

function actionEvent(input: {
  readonly value: "available" | "p" | "m" | "t";
  readonly payload?: string;
}) {
  return {
    type: "action",
    chatId: "telegram",
    conversation: { chatId: "telegram", conversationId: thread.threadId },
    actor: { kind: "user", actorId: "user-1", displayName: "Ishak", adapterData: {} },
    message: { chatId: "telegram", conversationId: thread.threadId, messageId: "action-1" },
    interactionId: "interaction-1",
    actionId: "model",
    value: input.value,
    ...(input.payload === undefined ? {} : { payload: input.payload }),
  };
}

function actionResponseText(message: unknown): string {
  if (typeof message === "string") {
    return message;
  }

  if (message && typeof message === "object" && "text" in message) {
    return String(message.text);
  }

  return "";
}

function sentMessage(input: {
  readonly text: string;
  readonly format?: "plain" | "markdown" | "html";
}) {
  return {
    chatId: "telegram" as const,
    conversationId: thread.threadId,
    messageId: "reply-1",
    text: input.text,
    format: input.format,
    adapterData: {},
  };
}

async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  expect(predicate()).toBe(true);
}
