import { Result } from "better-result";
import { describe, expect, test } from "vitest";
import { defineChatAdapter } from "@xmux/chat-core";
import {
  defineHarnessAdapter,
  type HarnessModelInfo,
  type HarnessModelRef,
  type HarnessSelectedModel,
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
    attachments: false,
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

  test("shows the current model and available models for the active session", async () => {
    const { emitCommand, replies, listInputs, getInputs, xmux } = await initializeXmux();
    await bindSession({ xmux });

    emitCommand(commandEvent({ selector: undefined }));

    await eventually(() => replies.length === 1);

    expect(listInputs).toEqual([{ harnessId: "opencode", cwd: process.cwd() }]);
    expect(getInputs).toEqual([{ target: { type: "session", ref: sessionRef } }]);
    expect(replies[0]).toContain("**Model**");
    expect(replies[0]).toContain("- Harness: `opencode`");
    expect(replies[0]).toContain("- Session ID: `session-1`");
    expect(replies[0]).toContain("- Current: `openai/gpt-4.1`");
    expect(replies[0]).toContain("- Source: session");
    expect(replies[0]).toContain("**Available models** (2)");
    expect(replies[0]).toContain("> **OpenAI** (1)");
    expect(replies[0]).toContain("- GPT\\-4\\.1 — current");
    expect(replies[0]).toContain("  - `/model openai/gpt-4.1`");
    expect(replies[0]).toContain("> **Anthropic** (1)");
    expect(replies[0]).toContain("- Claude 3\\.7 Sonnet");
    expect(replies[0]).toContain("  - `/model anthropic/claude-3-7-sonnet`");

    await xmux.shutdown();
  });

  test("limits listed models per provider using the default model config", async () => {
    const { emitCommand, replies, xmux } = await initializeXmux({
      models: [
        ...createProviderModels({ providerId: "openai", providerName: "OpenAI", count: 11 }),
        ...createProviderModels({ providerId: "google", providerName: "Google", count: 2 }),
      ],
    });
    await bindSession({ xmux });

    emitCommand(commandEvent({ selector: undefined }));

    await eventually(() => replies.length === 1);

    expect(replies[0]).toContain("> **OpenAI** (showing 10 of 11)");
    expect(replies[0]).toContain("- OpenAI Model 10");
    expect(replies[0]).not.toContain("- OpenAI Model 11");
    expect(replies[0]).toContain("_And 1 more models from OpenAI._");
    expect(replies[0]).toContain("> **Google** (2)");
    expect(replies[0]).toContain("- Google Model 2");

    await xmux.shutdown();
  });

  test("uses configured max models per provider", async () => {
    const { emitCommand, replies, xmux } = await initializeXmux({
      maxModelsPerProvider: 2,
      models: createProviderModels({ providerId: "openai", providerName: "OpenAI", count: 4 }),
    });
    await bindSession({ xmux });

    emitCommand(commandEvent({ selector: undefined }));

    await eventually(() => replies.length === 1);

    expect(replies[0]).toContain("> **OpenAI** (showing 2 of 4)");
    expect(replies[0]).toContain("- OpenAI Model 2");
    expect(replies[0]).not.toContain("- OpenAI Model 3");
    expect(replies[0]).toContain("_And 2 more models from OpenAI._");

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
      "**Model updated**\n\n- Current: `anthropic/claude-3-7-sonnet`\n- Harness: `opencode`\n- Session ID: `session-1`\n\nThis model is now selected for the current session.",
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
}

async function initializeXmux(input: InitializeXmuxInput = {}) {
  const replies: string[] = [];
  const listInputs: { readonly harnessId: string; readonly cwd?: string }[] = [];
  const getInputs: { readonly target: HarnessSelectedModel["target"] }[] = [];
  const setInputs: {
    readonly target: HarnessSelectedModel["target"];
    readonly update: { readonly type: "set"; readonly model: HarnessModelRef };
  }[] = [];
  let selectedModel: HarnessModelRef = { providerId: "openai", modelId: "gpt-4.1" };
  let emitCommand: ((event: unknown) => void) | undefined;

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
              emitCommand = context.emit as (event: unknown) => void;
              return Result.ok();
            },
            async sendMessage(messageInput) {
              return Result.ok(
                sentMessage({ text: messageInput.text, format: messageInput.format }),
              );
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
  expect(emitCommand).toBeDefined();

  return {
    replies,
    listInputs,
    getInputs,
    setInputs,
    emitCommand: emitCommand as (event: unknown) => void,
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
