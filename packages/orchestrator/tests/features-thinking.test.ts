import { Result } from "better-result";
import { describe, expect, test } from "vitest";
import { defineChatAdapter } from "@xmux/chat-core";
import {
  defineHarnessAdapter,
  type HarnessModelInfo,
  type HarnessModelRef,
  type HarnessModelTarget,
  type HarnessThinkingTarget,
  type HarnessThinkingLevel,
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
const supportedLevels = ["off", "low", "medium", "high", "xhigh", "max"] as const;

describe("/thinking command", () => {
  test("replies when no active session is bound to the thread", async () => {
    const { emitCommand, replies, getInputs, setInputs, xmux } = await initializeXmux();

    emitCommand(commandEvent({ level: undefined }));

    await eventually(() => replies.length === 1);

    expect(getInputs).toHaveLength(0);
    expect(setInputs).toHaveLength(0);
    expect(replies[0]).toBe(
      "**No active session**\n\nCreate or resume a session before changing thinking level.\n\nUse `/new <harnessId>` or `/resume` to continue.",
    );

    await xmux.shutdown();
  });

  test("shows the current thinking level with level buttons for the active session", async () => {
    const { emitCommand, replies, sentActions, getInputs, xmux } = await initializeXmux();
    await bindSession({ xmux });

    emitCommand(commandEvent({ level: undefined }));

    await eventually(() => sentActions.length === 1);

    expect(replies).toHaveLength(0);
    expect(getInputs).toEqual([{ target: { type: "session", ref: sessionRef } }]);
    expect(sentActions[0]?.text).toContain("**Thinking Level (Medium)**");
    expect(sentActions[0]?.text).toContain("- **Harness:** `opencode`");
    expect(sentActions[0]?.text).toContain("- **Session ID:** `session-1`");
    expect(sentActions[0]?.text).toContain("- **Current Level:** **`medium`**");
    expect(sentActions[0]?.text).toContain("- **Source:** **session**");
    expect(sentActions[0]?.text).not.toContain("**Supported levels**");
    expect(sentActions[0]?.text).not.toContain("- **`medium`** — current");
    expect(sentActions[0]?.text).not.toContain("- `xhigh`");
    expect(sentActions[0]?.buttons.flat().map((button) => button.value)).toEqual([
      "off",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(sentActions[0]?.buttons.flat().find((button) => button.value === "medium")?.label).toBe(
      "✓ Medium",
    );

    await xmux.shutdown();
  });

  test("sets a thinking level when a level button is pressed", async () => {
    const { emitCommand, emitAction, sentActions, actionResponses, setInputs, xmux } =
      await initializeXmux();
    await bindSession({ xmux });

    emitCommand(commandEvent({ level: undefined }));

    await eventually(() => sentActions.length === 1);

    emitAction(actionEvent({ value: "high" }));

    await eventually(() => actionResponses.length === 2);

    expect(setInputs).toEqual([
      {
        target: { type: "session", ref: sessionRef },
        update: { type: "set", level: "high" },
      },
    ]);
    expect(actionResponses[0]?.response.kind).toBe("ack");
    expect(actionResponses[1]?.response.kind).toBe("update");
    expect(actionResponses[1]?.response.message).toEqual({
      text: "**Thinking level updated**\n\n- **Thinking Level:** **`high`**\n- **Source:** **session**\n- **Harness:** `opencode`\n- **Session ID:** `session-1`\n\nThis thinking level is now selected for the current session.",
      format: "markdown",
    });
    const updatedButtons = actionResponses[1]?.response.buttons as
      | (typeof sentActions)[number]["buttons"]
      | undefined;
    expect(updatedButtons?.flat().find((button) => button.value === "high")?.label).toBe("✓ High");

    await xmux.shutdown();
  });

  test("sets a thinking level for the active session", async () => {
    const { emitCommand, replies, sentActions, setInputs, xmux } = await initializeXmux();
    await bindSession({ xmux });

    emitCommand(commandEvent({ level: "xhigh" }));

    await eventually(() => replies.length === 1);

    expect(sentActions).toHaveLength(0);
    expect(setInputs).toEqual([
      {
        target: { type: "session", ref: sessionRef },
        update: { type: "set", level: "xhigh" },
      },
    ]);
    expect(replies[0]).toBe(
      "**Thinking level updated**\n\n- **Thinking Level:** **`xhigh`**\n- **Source:** **session**\n- **Harness:** `opencode`\n- **Session ID:** `session-1`\n\nThis thinking level is now selected for the current session.",
    );

    await xmux.shutdown();
  });

  test("accepts max as a canonical thinking level", async () => {
    const { emitCommand, replies, setInputs, xmux } = await initializeXmux();
    await bindSession({ xmux });

    emitCommand(commandEvent({ level: "max" }));

    await eventually(() => replies.length === 1);

    expect(setInputs[0]?.update).toEqual({ type: "set", level: "max" });
    expect(replies[0]).toContain("- **Thinking Level:** **`max`**");

    await xmux.shutdown();
  });

  test("clears a thinking override for the active session", async () => {
    const { emitCommand, replies, setInputs, xmux } = await initializeXmux({
      initialLevel: "high",
      clearFallbackLevel: "low",
    });
    await bindSession({ xmux });

    emitCommand(commandEvent({ level: "clear" }));

    await eventually(() => replies.length === 1);

    expect(setInputs).toEqual([
      {
        target: { type: "session", ref: sessionRef },
        update: { type: "clear" },
      },
    ]);
    expect(replies[0]).toBe(
      "**Thinking override cleared**\n\n- **Current Level:** **`low`**\n- **Source:** **harness**\n- **Harness:** `opencode`\n- **Session ID:** `session-1`",
    );

    await xmux.shutdown();
  });

  test("asks to set a model first when model management reports no selected model", async () => {
    const { emitCommand, replies, setInputs, xmux } = await initializeXmux({
      supportModels: true,
      selectedModel: null,
    });
    await bindSession({ xmux });

    emitCommand(commandEvent({ level: "high" }));

    await eventually(() => replies.length === 1);

    expect(setInputs).toHaveLength(0);
    expect(replies[0]).toBe(
      "**Set a model first**\n\nThinking levels depend on the active model.\n\nUse `/model` to choose a model, then run `/thinking` again.",
    );

    await xmux.shutdown();
  });

  test("rejects invalid thinking levels without setting", async () => {
    const { emitCommand, replies, setInputs, xmux } = await initializeXmux();
    await bindSession({ xmux });

    emitCommand(commandEvent({ level: "xi" }));

    await eventually(() => replies.length === 1);

    expect(setInputs).toHaveLength(0);
    expect(replies[0]).toContain("**Invalid thinking level**");
    expect(replies[0]).toContain("- **Requested level:** `xi`");
    expect(replies[0]).toContain("- `xhigh`");
    expect(replies[0]).toContain("- `clear`");

    await xmux.shutdown();
  });

  test("reports models with no configurable thinking support on show", async () => {
    const { emitCommand, replies, setInputs, xmux } = await initializeXmux({
      supportModels: true,
      omitReportedSupportedLevels: true,
      modelSupportedLevels: ["off"],
    });
    await bindSession({ xmux });

    emitCommand(commandEvent({ level: undefined }));

    await eventually(() => replies.length === 1);

    expect(setInputs).toHaveLength(0);
    expect(replies[0]).toContain("**Thinking not supported**");
    expect(replies[0]).toContain("The active model does not support configurable thinking levels.");
    expect(replies[0]).toContain("- **Model:** `openai/gpt-4.1`");
    expect(replies[0]).toContain("- **Next:** choose a reasoning-capable model with `/model`.");

    await xmux.shutdown();
  });

  test("reports models with no configurable thinking support before setting", async () => {
    const { emitCommand, replies, setInputs, xmux } = await initializeXmux({
      supportModels: true,
      omitReportedSupportedLevels: true,
      modelSupportedLevels: ["off"],
    });
    await bindSession({ xmux });

    emitCommand(commandEvent({ level: "high" }));

    await eventually(() => replies.length === 1);

    expect(setInputs).toHaveLength(0);
    expect(replies[0]).toContain("**Thinking not supported**");
    expect(replies[0]).toContain("- **Model:** `openai/gpt-4.1`");

    await xmux.shutdown();
  });

  test("rejects levels not reported as supported by the active session", async () => {
    const { emitCommand, replies, setInputs, xmux } = await initializeXmux({
      supportedLevels: ["off", "low"],
    });
    await bindSession({ xmux });

    emitCommand(commandEvent({ level: "high" }));

    await eventually(() => replies.length === 1);

    expect(setInputs).toHaveLength(0);
    expect(replies[0]).toContain("**Thinking level unsupported**");
    expect(replies[0]).toContain("- **Requested level:** `high`");
    expect(replies[0]).toContain("- `off`");
    expect(replies[0]).toContain("- `low`");

    await xmux.shutdown();
  });

  test("formats unsupported thinking management errors", async () => {
    const { emitCommand, replies, xmux } = await initializeXmux({ supportThinking: false });
    await bindSession({ xmux });

    emitCommand(commandEvent({ level: undefined }));

    await eventually(() => replies.length === 1);

    expect(replies[0]).toBe(
      "**Thinking management unsupported**\n\nHarness `opencode` does not support thinking management yet.",
    );

    await xmux.shutdown();
  });

  test("reports closed active sessions", async () => {
    const { emitCommand, replies, getInputs, xmux } = await initializeXmux();
    await bindSession({ xmux, status: "closed" });

    emitCommand(commandEvent({ level: undefined }));

    await eventually(() => replies.length === 1);

    expect(getInputs).toHaveLength(0);
    expect(replies[0]).toBe(
      "**Session is closed**\n\nStart a new session with `/new <harnessId>`.",
    );

    await xmux.shutdown();
  });
});

interface InitializeXmuxInput {
  readonly initialLevel?: HarnessThinkingLevel;
  readonly clearFallbackLevel?: HarnessThinkingLevel;
  readonly supportedLevels?: readonly HarnessThinkingLevel[];
  readonly supportThinking?: boolean;
  readonly supportModels?: boolean;
  readonly selectedModel?: HarnessModelRef | null;
  readonly omitReportedSupportedLevels?: boolean;
  readonly modelSupportedLevels?: readonly HarnessThinkingLevel[];
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
  const getInputs: { readonly target: HarnessThinkingTarget<"opencode"> }[] = [];
  const modelGetInputs: { readonly target: HarnessModelTarget<"opencode"> }[] = [];
  const setInputs: {
    readonly target: HarnessThinkingTarget<"opencode">;
    readonly update:
      | { readonly type: "set"; readonly level: HarnessThinkingLevel }
      | { readonly type: "clear" };
  }[] = [];
  let selectedLevel: HarnessThinkingLevel | undefined = input.initialLevel ?? "medium";
  const selectedModel =
    input.selectedModel === null
      ? undefined
      : (input.selectedModel ?? {
          providerId: "openai",
          modelId: "gpt-4.1",
        });
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

          const modelOperations = input.supportModels
            ? {
                async listModels() {
                  return Result.ok(
                    selectedModel === undefined
                      ? []
                      : [
                          createModelInfo({
                            ref: selectedModel,
                            supportedLevels: input.modelSupportedLevels ?? supportedLevels,
                          }),
                        ],
                  );
                },
                async getModel(getInput: { readonly target: HarnessModelTarget<"opencode"> }) {
                  modelGetInputs.push({ target: getInput.target });
                  return Result.ok({
                    target: getInput.target,
                    ...(selectedModel === undefined ? {} : { model: selectedModel }),
                    source: selectedModel === undefined ? ("unset" as const) : ("session" as const),
                  });
                },
              }
            : {};

          if (input.supportThinking === false) {
            return Result.ok({ ...runtime, ...modelOperations });
          }

          return Result.ok({
            ...runtime,
            ...modelOperations,
            async getThinking(getInput: { readonly target: HarnessThinkingTarget<"opencode"> }) {
              getInputs.push({ target: getInput.target });
              return Result.ok({
                target: getInput.target,
                ...(selectedLevel === undefined ? {} : { level: selectedLevel }),
                ...(input.omitReportedSupportedLevels
                  ? {}
                  : { supportedLevels: input.supportedLevels ?? supportedLevels }),
                source: selectedLevel === undefined ? ("unset" as const) : ("session" as const),
              });
            },
            async setThinking(setInput: {
              readonly target: HarnessThinkingTarget<"opencode">;
              readonly update:
                | { readonly type: "set"; readonly level: HarnessThinkingLevel }
                | { readonly type: "clear" };
            }) {
              setInputs.push({ target: setInput.target, update: setInput.update });
              selectedLevel =
                setInput.update.type === "set" ? setInput.update.level : input.clearFallbackLevel;
              return Result.ok({
                target: setInput.target,
                ...(selectedLevel === undefined ? {} : { level: selectedLevel }),
                ...(input.omitReportedSupportedLevels
                  ? {}
                  : { supportedLevels: input.supportedLevels ?? supportedLevels }),
                source:
                  setInput.update.type === "clear"
                    ? input.clearFallbackLevel === undefined
                      ? ("unset" as const)
                      : ("harness" as const)
                    : ("session" as const),
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
    },
  });

  expect((await xmux.initialize()).isOk()).toBe(true);
  expect(emitEvent).toBeDefined();

  return {
    replies,
    sentActions,
    actionResponses,
    getInputs,
    modelGetInputs,
    setInputs,
    emitCommand: emitEvent as (event: unknown) => void,
    emitAction: emitEvent as (event: unknown) => void,
    xmux,
  };
}

function createModelInfo(input: {
  readonly ref: HarnessModelRef;
  readonly supportedLevels: readonly HarnessThinkingLevel[];
}): HarnessModelInfo<"opencode"> {
  return {
    harnessId: "opencode",
    ref: input.ref,
    name: input.ref.modelId,
    capabilities: {
      thinking: { supportedLevels: input.supportedLevels },
    },
    adapterData: {},
  };
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

function commandEvent(input: { readonly level?: string }) {
  return {
    type: "command",
    chatId: "telegram",
    conversation: { chatId: "telegram", conversationId: thread.threadId },
    actor: { kind: "user", actorId: "user-1", displayName: "Ishak", adapterData: {} },
    message: { chatId: "telegram", conversationId: thread.threadId, messageId: "message-1" },
    command: {
      name: "thinking",
      options: { level: input.level },
    },
  };
}

function actionEvent(input: { readonly value: HarnessThinkingLevel }) {
  return {
    type: "action",
    chatId: "telegram",
    conversation: { chatId: "telegram", conversationId: thread.threadId },
    actor: { kind: "user", actorId: "user-1", displayName: "Ishak", adapterData: {} },
    message: { chatId: "telegram", conversationId: thread.threadId, messageId: "action-1" },
    interactionId: "interaction-1",
    actionId: "thinking",
    value: input.value,
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
