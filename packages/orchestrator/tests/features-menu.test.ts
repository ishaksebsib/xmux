import { Result } from "better-result";
import { describe, expect, test } from "vitest";
import { defineChatAdapter } from "@xmux/chat-core";
import { defineHarnessAdapter } from "@xmux/harness-core";
import { createXmux } from "../src";
import {
  createMenuRegistry,
  defineMenuCommandItem,
  defineMenuItemId,
  parseMenuItemId,
} from "../src/features/menu";
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
  actions: {
    send: true,
    receive: true,
    ack: true,
    reply: true,
    update: true,
    urlButtons: true,
  },
} as const;

const thread = { chatId: "telegram", threadId: "conversation-1" } as const;
const sessionRef = { harnessId: "opencode", sessionId: "session-1" } as const;

describe("menu item ids", () => {
  test("parse compact branded ids at the callback boundary", () => {
    expect(parseMenuItemId("feature:open").isOk()).toBe(true);
    expect(parseMenuItemId("feature-open").isErr()).toBe(true);
    expect(parseMenuItemId("Feature:open").isErr()).toBe(true);
    expect(parseMenuItemId("feature-name:open").isErr()).toBe(true);
  });
});

describe("menu registry", () => {
  test("rejects duplicate feature-owned menu ids", () => {
    const id = defineMenuItemId({ feature: "test", local: "open" });
    const item = defineMenuCommandItem({
      id,
      label: "Test",
      order: 1,
      visible: () => true,
      command: () => ({ name: "pwd", options: {} }),
    });
    const registry = createMenuRegistry();

    const registered = registry.register(item);
    expect(registered.isOk()).toBe(true);
    expect(registry.register(item).isErr()).toBe(true);

    if (registered.isErr()) throw registered.error;
    registered.value();

    expect(registry.register(item).isOk()).toBe(true);
  });
});

describe("/menu command", () => {
  test("shows only session-start actions when there is no active session", async () => {
    const { emitEvent, actionMessages, xmux } = await initializeXmux();

    emitEvent(menuCommandEvent());

    await eventually(() => actionMessages.length === 1);

    expect(buttonLabels(actionMessages[0])).toEqual(["New session", "Resume session", "$pwd"]);
    expect(actionMessages[0]?.text).toContain("No active session.");

    await xmux.shutdown();
  });

  test("shows active-session actions and hides resume/new when a session is active", async () => {
    const { emitEvent, actionMessages, xmux } = await initializeXmux();
    await bindSession(xmux);

    emitEvent(menuCommandEvent());

    await eventually(() => actionMessages.length === 1);

    expect(buttonLabels(actionMessages[0])).toEqual([
      "Model",
      "Thinking",
      "Exit session",
      "Delete session",
      "$pwd",
    ]);
    expect(actionMessages[0]?.text).toContain("- Model: `openai/gpt-5.5`");
    expect(actionMessages[0]?.text).toContain("- Thinking Level: `off`");
    expect(actionMessages[0]?.text).toContain("- Harness: `opencode`");
    expect(actionMessages[0]?.text).toContain("- Session ID: `session-1`");

    await xmux.shutdown();
  });

  test("menu button click injects the original command flow", async () => {
    const { emitEvent, actionMessages, actionAcks, listInputs, xmux } = await initializeXmux();

    emitEvent(menuCommandEvent());
    await eventually(() => actionMessages.length === 1);

    const resume = buttonByLabel(actionMessages[0], "Resume session");
    emitEvent(menuActionEvent(resume.payload));

    await eventually(() => actionAcks.length === 1 && actionMessages.length === 2);

    expect(listInputs).toEqual([{ cwd: process.cwd() }]);
    expect(actionMessages[1]?.text).toContain("**opencode sessions** (1)");
    expect(buttonLabels(actionMessages[1])).toEqual(["Resume ses"]);

    await xmux.shutdown();
  });
});

interface CapturedActionMessage {
  readonly text: string;
  readonly buttons: readonly (readonly ActionButtonFixture[])[];
}

interface ActionButtonFixture {
  readonly label: string;
  readonly payload?: unknown;
}

async function initializeXmux() {
  const actionMessages: CapturedActionMessage[] = [];
  const actionAcks: string[] = [];
  const replies: string[] = [];
  const listInputs: { readonly cwd?: string }[] = [];
  let emitEvent: ((event: unknown) => void) | undefined;

  const xmux = createXmux({
    harnesses: {
      opencode: defineHarnessAdapter<"opencode">({
        id: "opencode",
        async open() {
          return Result.ok({
            id: "opencode" as const,
            async createSession() {
              return Result.ok({ sessionId: "created-session", adapterData: {} });
            },
            async resumeSession() {
              return Result.err(new Error("not implemented"));
            },
            async listSessions(input: { readonly cwd?: string }) {
              listInputs.push({ cwd: input.cwd });
              return Result.ok([
                {
                  sessionId: "session-1",
                  cwd: process.cwd(),
                  title: "Fix bug",
                  adapterData: {},
                },
              ]);
            },
            async getSession() {
              return Result.err(new Error("not implemented"));
            },
            async listModels() {
              return Result.ok([
                {
                  harnessId: "opencode" as const,
                  ref: { providerId: "openai", modelId: "gpt-5.5" },
                  name: "GPT 5.5",
                  capabilities: {
                    thinking: { supportedLevels: ["off", "low", "medium", "high"] },
                  },
                  adapterData: {},
                },
              ]);
            },
            async getModel() {
              return Result.ok({
                target: { type: "session", ref: sessionRef },
                model: { providerId: "openai", modelId: "gpt-5.5" },
                source: "session",
              });
            },
            async getThinking() {
              return Result.ok({
                target: { type: "session", ref: sessionRef },
                level: "off",
                supportedLevels: ["off", "low", "medium", "high"],
                source: "session",
              });
            },
            async prompt() {
              return Result.err(new Error("not implemented"));
            },
            async deleteSession() {
              return Result.ok();
            },
            async abort() {
              return Result.ok();
            },
            close: async () => {},
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
            id: "telegram" as const,
            async start(context) {
              emitEvent = context.emit as (event: unknown) => void;
              return Result.ok();
            },
            async sendMessage(input) {
              return Result.ok(sentMessage({ text: input.text, format: input.format }));
            },
            async sendAction(input) {
              actionMessages.push({
                text: input.text,
                buttons: input.buttons as readonly (readonly ActionButtonFixture[])[],
              });
              return Result.ok({
                chatId: input.chatId,
                conversationId: input.conversationId,
                messageId: `action-${actionMessages.length}`,
                text: input.text,
                adapterData: {},
              });
            },
            async respondToAction(input) {
              if (input.response.kind === "ack") {
                actionAcks.push(input.interactionId);
              }
              if (input.response.kind === "reply") {
                replies.push(textInput(input.response.message));
              }
              if (input.response.kind === "update" && input.response.message !== undefined) {
                actionMessages.push({
                  text: textInput(input.response.message),
                  buttons: (input.response.buttons ??
                    []) as readonly (readonly ActionButtonFixture[])[],
                });
              }
              return Result.ok();
            },
            async reply(input) {
              replies.push(input.text);
              return Result.ok(sentMessage({ text: input.text, format: input.format }));
            },
            close: async () => {},
          });
        },
      }),
    },
    config: {
      defaultWorkingDirectory: process.cwd(),
      deliveryMode: "requester_only",
    },
  });

  expect((await xmux.initialize()).isOk()).toBe(true);
  expect(emitEvent).toBeDefined();

  return {
    actionMessages,
    actionAcks,
    listInputs,
    replies,
    emitEvent: emitEvent as (event: unknown) => void,
    xmux,
  };
}

async function bindSession(xmux: Awaited<ReturnType<typeof initializeXmux>>["xmux"]) {
  const now = new Date().toISOString();
  expect(
    (
      await xmux.ctx.store.sessions.create(
        createSessionRecord({
          ref: sessionRef,
          origin: thread,
          requester: { userId: "user-1" },
          cwd: process.cwd(),
          title: "Fix bug",
          now,
        }),
      )
    ).isOk(),
  ).toBe(true);
  expect(
    (
      await xmux.ctx.store.threadBindings.bind(createThreadBinding({ thread, sessionRef, now }))
    ).isOk(),
  ).toBe(true);
}

function menuCommandEvent() {
  return {
    type: "command",
    chatId: "telegram",
    conversation: { chatId: "telegram", conversationId: thread.threadId },
    actor: { kind: "user", actorId: "user-1", displayName: "Ishak", adapterData: {} },
    message: { chatId: "telegram", conversationId: thread.threadId, messageId: "message-1" },
    command: { name: "menu", options: {} },
  };
}

function menuActionEvent(payload: unknown) {
  return {
    type: "action",
    chatId: "telegram",
    conversation: { chatId: "telegram", conversationId: thread.threadId },
    message: { chatId: "telegram", conversationId: thread.threadId, messageId: "action-1" },
    interactionId: "menu-action-1",
    actor: { kind: "user", actorId: "user-1", displayName: "Ishak", adapterData: {} },
    actionId: "mn",
    value: "x",
    payload,
  };
}

function buttonLabels(message: CapturedActionMessage | undefined): readonly string[] {
  return message === undefined ? [] : message.buttons.flat().map((button) => button.label);
}

function buttonByLabel(
  message: CapturedActionMessage | undefined,
  label: string,
): ActionButtonFixture {
  const button = message?.buttons.flat().find((candidate) => candidate.label === label);
  expect(button).toBeDefined();
  return button as ActionButtonFixture;
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

function textInput(input: string | { readonly text: string }): string {
  return typeof input === "string" ? input : input.text;
}

async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  expect(predicate()).toBe(true);
}
