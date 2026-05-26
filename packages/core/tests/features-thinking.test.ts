import { Result } from "better-result";
import { describe, expect, test } from "vitest";
import { defineChatAdapter } from "@xmux/chat-core";
import {
  defineHarnessAdapter,
  type HarnessSelectedThinking,
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
    attachments: false,
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

  test("shows the current thinking level for the active session", async () => {
    const { emitCommand, replies, getInputs, xmux } = await initializeXmux();
    await bindSession({ xmux });

    emitCommand(commandEvent({ level: undefined }));

    await eventually(() => replies.length === 1);

    expect(getInputs).toEqual([{ target: { type: "session", ref: sessionRef } }]);
    expect(replies[0]).toContain("**Thinking**");
    expect(replies[0]).toContain("- Harness: `opencode`");
    expect(replies[0]).toContain("- Session ID: `session-1`");
    expect(replies[0]).toContain("- Current: `medium`");
    expect(replies[0]).toContain("- Source: session");
    expect(replies[0]).toContain("**Supported levels** (6)");
    expect(replies[0]).toContain("- `medium` — current");
    expect(replies[0]).toContain("- `xhigh`");

    await xmux.shutdown();
  });

  test("sets a thinking level for the active session", async () => {
    const { emitCommand, replies, setInputs, xmux } = await initializeXmux();
    await bindSession({ xmux });

    emitCommand(commandEvent({ level: "xhigh" }));

    await eventually(() => replies.length === 1);

    expect(setInputs).toEqual([
      {
        target: { type: "session", ref: sessionRef },
        update: { type: "set", level: "xhigh" },
      },
    ]);
    expect(replies[0]).toBe(
      "**Thinking updated**\n\n- Current: `xhigh`\n- Source: session\n- Harness: `opencode`\n- Session ID: `session-1`\n\nThis thinking level is now selected for the current session.",
    );

    await xmux.shutdown();
  });

  test("accepts max as a canonical thinking level", async () => {
    const { emitCommand, replies, setInputs, xmux } = await initializeXmux();
    await bindSession({ xmux });

    emitCommand(commandEvent({ level: "max" }));

    await eventually(() => replies.length === 1);

    expect(setInputs[0]?.update).toEqual({ type: "set", level: "max" });
    expect(replies[0]).toContain("- Current: `max`");

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
      "**Thinking override cleared**\n\n- Current: `low`\n- Source: harness\n- Harness: `opencode`\n- Session ID: `session-1`",
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
    expect(replies[0]).toContain("Level: `xi`");
    expect(replies[0]).toContain("- `xhigh`");
    expect(replies[0]).toContain("- `clear`");

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
    expect(replies[0]).toContain("Level: `high`");
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
}

async function initializeXmux(input: InitializeXmuxInput = {}) {
  const replies: string[] = [];
  const getInputs: { readonly target: HarnessSelectedThinking["target"] }[] = [];
  const setInputs: {
    readonly target: HarnessSelectedThinking["target"];
    readonly update:
      | { readonly type: "set"; readonly level: HarnessThinkingLevel }
      | { readonly type: "clear" };
  }[] = [];
  let selectedLevel: HarnessThinkingLevel | undefined = input.initialLevel ?? "medium";
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

          if (input.supportThinking === false) {
            return Result.ok(runtime);
          }

          return Result.ok({
            ...runtime,
            async getThinking(getInput: { readonly target: HarnessSelectedThinking["target"] }) {
              getInputs.push({ target: getInput.target });
              return Result.ok({
                target: getInput.target,
                ...(selectedLevel === undefined ? {} : { level: selectedLevel }),
                supportedLevels: input.supportedLevels ?? supportedLevels,
                source: selectedLevel === undefined ? ("unset" as const) : ("session" as const),
              });
            },
            async setThinking(setInput: {
              readonly target: HarnessSelectedThinking["target"];
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
                supportedLevels: input.supportedLevels ?? supportedLevels,
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
    },
  });

  expect((await xmux.initialize()).isOk()).toBe(true);
  expect(emitCommand).toBeDefined();

  return {
    replies,
    getInputs,
    setInputs,
    emitCommand: emitCommand as (event: unknown) => void,
    xmux,
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
