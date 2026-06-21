import { Result } from "better-result";
import { describe, expect, test } from "vitest";
import { defineChatAdapter } from "@xmux/chat-core";
import { defineHarnessAdapter } from "@xmux/harness-core";
import { createXmux } from "../src";
import { createThreadWorkspace } from "../src/store";

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

describe("/resume command", () => {
  test("shows harness choices before listing sessions", async () => {
    const { emitCommand, actionMessages, listInputs, xmux } = await initializeXmux();

    emitCommand(commandEvent({ options: { harnessId: undefined, shortId: undefined } }));

    await eventually(() => actionMessages.length === 1);

    expect(listInputs).toEqual([]);
    expect(actionMessages[0]?.text).toContain("**Choose a harness**");
    expect(actionMessages[0]?.text).toContain("Pick one to view sessions.");
    expect(actionMessages[0]?.text).not.toContain("Fix bug");
    expect(actionMessages[0]?.buttons).toEqual([
      [
        expect.objectContaining({
          label: "opencode sessions",
          actionId: "rh",
          value: "x",
          payload: "opencode",
        }),
      ],
      [
        expect.objectContaining({
          label: "pi sessions",
          actionId: "rh",
          value: "x",
          payload: "pi",
        }),
      ],
    ]);
    expect(
      encodedTelegramCallbackLength(actionMessages[0]?.buttons[0]?.[0] as ActionButtonFixture),
    ).toBeLessThanOrEqual(64);

    await xmux.shutdown();
  });

  test("defaults to the only configured harness before listing sessions", async () => {
    const { emitCommand, actionMessages, listInputs, xmux } = await initializeXmux({
      includePi: false,
    });

    emitCommand(commandEvent({ options: { harnessId: undefined, shortId: undefined } }));

    await eventually(() => actionMessages.length === 1);

    expect(listInputs).toEqual([{ harnessId: "opencode", cwd: process.cwd() }]);
    expect(actionMessages[0]?.text).toContain("**opencode sessions** (3)");
    expect(actionMessages[0]?.text).not.toContain("**Choose a harness**");
    expect(actionMessages[0]?.text).not.toContain("PI session");
    expect(actionMessages[0]?.buttons).toEqual([
      [expect.objectContaining({ label: "Resume abc1", payload: "opencode:abc1" })],
      [expect.objectContaining({ label: "Resume abc2", payload: "opencode:abc2" })],
      [expect.objectContaining({ label: "Resume xy9", payload: "opencode:xy9" })],
    ]);

    await xmux.shutdown();
  });

  test("lists sessions for the selected harness with resume buttons", async () => {
    const { emitHarnessAction, actionUpdates, listInputs, xmux } = await initializeXmux();

    emitHarnessAction("opencode");

    await eventually(() => actionUpdates.length === 1);

    expect(listInputs).toEqual([{ harnessId: "opencode", cwd: process.cwd() }]);
    expect(actionUpdates[0]?.text).toContain("**opencode sessions** (3)");
    expect(actionUpdates[0]?.text).toContain(
      "- Title: Fix bug\n  Short ID: `abc1`\n  Command: `/resume opencode abc1`",
    );
    expect(actionUpdates[0]?.text).toContain("Short ID: `abc2`");
    expect(actionUpdates[0]?.text).toContain("Title: Refactor auth");
    expect(actionUpdates[0]?.text).toContain("Command: `/resume opencode abc2`");
    expect(actionUpdates[0]?.text).toContain("Short ID: `xy9`");
    expect(actionUpdates[0]?.text).toContain("Title: Cleanup");
    expect(actionUpdates[0]?.text).toContain("Command: `/resume opencode xy9`");
    expect(actionUpdates[0]?.text).not.toContain("PI session");
    expect(actionUpdates[0]?.buttons).toEqual([
      [
        expect.objectContaining({
          label: "Resume abc1",
          actionId: "r",
          value: "x",
          payload: "opencode:abc1",
          style: "primary",
        }),
      ],
      [expect.objectContaining({ label: "Resume abc2", payload: "opencode:abc2" })],
      [expect.objectContaining({ label: "Resume xy9", payload: "opencode:xy9" })],
    ]);
    expect(
      encodedTelegramCallbackLength(actionUpdates[0]?.buttons[1]?.[0] as ActionButtonFixture),
    ).toBeLessThanOrEqual(64);

    await xmux.shutdown();
  });

  test("limits listed sessions per harness using the default resume config", async () => {
    const { emitHarnessAction, actionUpdates, xmux } = await initializeXmux({
      opencodeSessions: createSessions("opencode", 6),
      piSessions: [],
    });

    emitHarnessAction("opencode");

    await eventually(() => actionUpdates.length === 1);

    expect(actionUpdates[0]?.text).toContain("**opencode sessions** (6)");
    expect(actionUpdates[0]?.text).toContain("Title: opencode 5");
    expect(actionUpdates[0]?.text).not.toContain("Title: opencode 6");
    expect(actionUpdates[0]?.text).toContain("_And 1 more sessions._");

    await xmux.shutdown();
  });

  test("uses configured max resume sessions per harness", async () => {
    const { emitHarnessAction, actionUpdates, xmux } = await initializeXmux({
      maxSessionsPerHarness: 2,
      opencodeSessions: createSessions("opencode", 4),
      piSessions: [],
    });

    emitHarnessAction("opencode");

    await eventually(() => actionUpdates.length === 1);

    expect(actionUpdates[0]?.text).toContain("**opencode sessions** (4)");
    expect(actionUpdates[0]?.text).toContain("Title: opencode 2");
    expect(actionUpdates[0]?.text).not.toContain("Title: opencode 3");
    expect(actionUpdates[0]?.text).toContain("_And 2 more sessions._");

    await xmux.shutdown();
  });

  test("reports an empty selected harness without resume buttons", async () => {
    const { emitHarnessAction, replies, actionUpdates, xmux } = await initializeXmux({
      opencodeSessions: [],
    });

    emitHarnessAction("opencode");

    await eventually(() => actionUpdates.length === 1);

    expect(replies).toHaveLength(0);
    expect(actionUpdates[0]?.text).toContain("**opencode sessions**");
    expect(actionUpdates[0]?.text).toContain("No sessions found.");
    expect(actionUpdates[0]?.buttons).toEqual([]);

    await xmux.shutdown();
  });

  test("resumes the selected session from a session button and updates the message", async () => {
    const { emitResumeAction, replies, actionUpdates, resumeInputs, xmux } = await initializeXmux();

    emitResumeAction({ harnessId: "opencode", shortId: "abc2" });

    await eventually(() => actionUpdates.length === 1);

    expect(replies).toHaveLength(0);
    expect(resumeInputs).toEqual([
      { harnessId: "opencode", sessionId: "abc222", cwd: process.cwd() },
    ]);
    expect(actionUpdates[0]?.text).toContain("**Resumed** `opencode/abc2`");
    expect(actionUpdates[0]?.text).toContain("- Title: Refactor auth");
    expect(actionUpdates[0]?.text).toContain("- Model: `test-provider/test-model`");
    expect(actionUpdates[0]?.buttons).toEqual([]);

    const binding = await xmux.ctx.store.threadBindings.get(thread);
    expect(binding.unwrap("expected binding lookup to succeed")).toMatchObject({
      thread,
      sessionRef: { harnessId: "opencode", sessionId: "abc222" },
    });

    await xmux.shutdown();
  });

  test("resolves hidden sessions because resume lookup uses the full harness list", async () => {
    const { emitCommand, replies, resumeInputs, xmux } = await initializeXmux({
      maxSessionsPerHarness: 1,
      opencodeSessions: createSessions("opencode", 2),
      piSessions: [],
    });

    emitCommand(commandEvent({ options: { harnessId: "opencode", shortId: "opencode-2" } }));

    await eventually(() => replies.length === 1);

    expect(resumeInputs).toEqual([
      { harnessId: "opencode", sessionId: "opencode-2", cwd: process.cwd() },
    ]);
    expect(replies[0]).toContain("**Resumed** `opencode/opencode-2`");
    expect(replies[0]).toContain("- Model: `test-provider/test-model`");

    await xmux.shutdown();
  });

  test("resolves a short id to the real session id, resumes it, and binds the thread", async () => {
    const { emitCommand, replies, resumeInputs, xmux } = await initializeXmux();

    emitCommand(commandEvent({ options: { harnessId: "opencode", shortId: "abc2" } }));

    await eventually(() => replies.length === 1);

    expect(resumeInputs).toEqual([
      { harnessId: "opencode", sessionId: "abc222", cwd: process.cwd() },
    ]);
    expect(replies[0]).toContain("**Resumed** `opencode/abc2`");
    expect(replies[0]).toContain("- Harness: `opencode`");
    expect(replies[0]).toContain("- Short ID: `abc2`");
    expect(replies[0]).toContain("- Title: Refactor auth");
    expect(replies[0]).toContain("- Model: `test-provider/test-model`");
    expect(replies[0]).toContain("- Directory: ");
    expect(replies[0]).toContain("Send a message to continue the conversation.");

    const binding = await xmux.ctx.store.threadBindings.get(thread);
    expect(binding.unwrap("expected binding lookup to succeed")).toMatchObject({
      thread,
      sessionRef: { harnessId: "opencode", sessionId: "abc222" },
    });

    const session = await xmux.ctx.store.sessions.get({
      harnessId: "opencode",
      sessionId: "abc222",
    });
    expect(session.unwrap("expected session lookup to succeed")).toMatchObject({
      ref: { harnessId: "opencode", sessionId: "abc222" },
      cwd: process.cwd(),
      title: "Refactor auth",
      status: "open",
    });

    await xmux.shutdown();
  });

  test("uses the current thread cwd when listing and resuming", async () => {
    const cwd = process.cwd();
    const { emitCommand, listInputs, resumeInputs, xmux } = await initializeXmux();
    await xmux.ctx.store.workspaces.set(
      createThreadWorkspace({ thread, cwd, now: new Date().toISOString() }),
    );

    emitCommand(commandEvent({ options: { harnessId: "pi", shortId: "abc" } }));

    await eventually(() => resumeInputs.length === 1);

    expect(listInputs).toContainEqual({ harnessId: "pi", cwd });
    expect(resumeInputs).toEqual([{ harnessId: "pi", sessionId: "abc999", cwd }]);

    await xmux.shutdown();
  });

  test("reports ambiguous short ids instead of guessing", async () => {
    const { emitCommand, replies, resumeInputs, xmux } = await initializeXmux();

    emitCommand(commandEvent({ options: { harnessId: "opencode", shortId: "abc" } }));

    await eventually(() => replies.length === 1);

    expect(resumeInputs).toHaveLength(0);
    expect(replies[0]).toContain("**Short ID is ambiguous**");
    expect(replies[0]).toContain("- Harness: `opencode`");
    expect(replies[0]).toContain("- Short ID: `abc`");
    expect(replies[0]).toContain("`abc111`");
    expect(replies[0]).toContain("`abc222`");

    await xmux.shutdown();
  });

  test("reports an incomplete resume target", async () => {
    const { emitCommand, replies, xmux } = await initializeXmux();

    emitCommand(commandEvent({ options: { harnessId: "opencode", shortId: undefined } }));

    await eventually(() => replies.length === 1);

    expect(replies[0]).toContain("**Incomplete resume command**");
    expect(replies[0]).toContain("`/resume <harnessId> <shortId>`");

    await xmux.shutdown();
  });
});

interface InitializeXmuxInput {
  readonly includePi?: boolean;
  readonly maxSessionsPerHarness?: number;
  readonly opencodeSessions?: readonly SessionFixture[];
  readonly piSessions?: readonly SessionFixture[];
}

interface SessionFixture {
  readonly sessionId: string;
  readonly title: string;
}

async function initializeXmux(input: InitializeXmuxInput = {}) {
  const replies: string[] = [];
  const actionMessages: {
    readonly text: string;
    readonly buttons: readonly (readonly unknown[])[];
  }[] = [];
  const actionUpdates: {
    readonly text: string;
    readonly buttons: readonly (readonly unknown[])[];
  }[] = [];
  const listInputs: { readonly harnessId: string; readonly cwd?: string }[] = [];
  const resumeInputs: {
    readonly harnessId: string;
    readonly sessionId: string;
    readonly cwd?: string;
  }[] = [];
  let emitCommand: ((event: unknown) => void) | undefined;

  const opencode = defineHarnessAdapter<"opencode">({
    id: "opencode",
    async open() {
      return Result.ok(
        createHarnessRuntime({
          harnessId: "opencode",
          listInputs,
          resumeInputs,
          sessions: input.opencodeSessions ?? [
            { sessionId: "abc111", title: "Fix bug" },
            { sessionId: "abc222", title: "Refactor auth" },
            { sessionId: "xy9", title: "Cleanup" },
          ],
        }),
      );
    },
  });
  const pi = defineHarnessAdapter<"pi">({
    id: "pi",
    async open() {
      return Result.ok(
        createHarnessRuntime({
          harnessId: "pi",
          listInputs,
          resumeInputs,
          sessions: input.piSessions ?? [{ sessionId: "abc999", title: "PI session" }],
        }),
      );
    },
  });
  const harnesses = input.includePi === false ? { opencode } : { opencode, pi };

  const xmux = createXmux({
    harnesses,
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
            async sendMessage(input) {
              return Result.ok(sentMessage({ text: input.text, format: input.format }));
            },
            async sendAction(input) {
              actionMessages.push({ text: input.text, buttons: input.buttons });
              return Result.ok({
                chatId: input.chatId,
                conversationId: input.conversationId,
                messageId: "action-1",
                text: input.text,
                adapterData: {},
              });
            },
            async respondToAction(input) {
              if (input.response.kind === "reply") {
                const message = input.response.message;
                replies.push(typeof message === "string" ? message : message.text);
              }
              if (input.response.kind === "update" && input.response.message) {
                const message = input.response.message;
                actionUpdates.push({
                  text: typeof message === "string" ? message : message.text,
                  buttons: input.response.buttons ?? [],
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
      ...(input.maxSessionsPerHarness === undefined
        ? {}
        : { resume: { maxSessionsPerHarness: input.maxSessionsPerHarness } }),
    },
  });

  expect((await xmux.initialize()).isOk()).toBe(true);
  expect(emitCommand).toBeDefined();

  return {
    replies,
    actionMessages,
    actionUpdates,
    listInputs,
    resumeInputs,
    emitCommand: emitCommand as (event: unknown) => void,
    emitHarnessAction: (harnessId: string) =>
      (emitCommand as (event: unknown) => void)(harnessActionEvent(harnessId)),
    emitResumeAction: (target: { readonly harnessId: string; readonly shortId: string }) =>
      (emitCommand as (event: unknown) => void)(resumeActionEvent(target)),
    xmux,
  };
}

function createSessions(prefix: string, count: number): readonly SessionFixture[] {
  return Array.from({ length: count }, (_, index) => ({
    sessionId: `${prefix}-${index + 1}`,
    title: `${prefix} ${index + 1}`,
  }));
}

function createHarnessRuntime<const THarnessId extends "opencode" | "pi">(input: {
  readonly harnessId: THarnessId;
  readonly listInputs: { readonly harnessId: string; readonly cwd?: string }[];
  readonly resumeInputs: {
    readonly harnessId: string;
    readonly sessionId: string;
    readonly cwd?: string;
  }[];
  readonly sessions: readonly SessionFixture[];
}) {
  return {
    id: input.harnessId,
    async createSession() {
      return Result.err(new Error("not implemented"));
    },
    async resumeSession(resumeInput: { readonly sessionId: string; readonly cwd?: string }) {
      input.resumeInputs.push({
        harnessId: input.harnessId,
        sessionId: resumeInput.sessionId,
        cwd: resumeInput.cwd,
      });
      const session = input.sessions.find(
        (candidate) => candidate.sessionId === resumeInput.sessionId,
      );
      if (!session) {
        return Result.err(new Error("missing session"));
      }

      return Result.ok({
        sessionId: session.sessionId,
        cwd: resumeInput.cwd ?? process.cwd(),
        title: session.title,
        model: { providerId: "test-provider", modelId: "test-model" },
        adapterData: {},
      });
    },
    async listSessions(listInput: { readonly cwd?: string }) {
      input.listInputs.push({ harnessId: input.harnessId, cwd: listInput.cwd });
      return Result.ok(
        input.sessions.map((session) => ({
          sessionId: session.sessionId,
          cwd: listInput.cwd ?? process.cwd(),
          title: session.title,
          adapterData: {},
        })),
      );
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
}

function commandEvent(input: {
  readonly options: { readonly harnessId?: string; readonly shortId?: string };
}) {
  return {
    type: "command",
    chatId: "telegram",
    conversation: { chatId: "telegram", conversationId: thread.threadId },
    actor: { kind: "user", actorId: "user-1", displayName: "Ishak", adapterData: {} },
    message: { chatId: "telegram", conversationId: thread.threadId, messageId: "message-1" },
    command: {
      name: "resume",
      options: input.options,
    },
  };
}

function harnessActionEvent(harnessId: string) {
  return {
    type: "action",
    chatId: "telegram",
    conversation: { chatId: "telegram", conversationId: thread.threadId },
    message: { chatId: "telegram", conversationId: thread.threadId, messageId: "1" },
    interactionId: "resume-harness-1",
    actor: { kind: "user", actorId: "user-1", displayName: "Ishak", adapterData: {} },
    actionId: "rh",
    value: "x",
    payload: harnessId,
  };
}

function resumeActionEvent(input: { readonly harnessId: string; readonly shortId: string }) {
  return {
    type: "action",
    chatId: "telegram",
    conversation: { chatId: "telegram", conversationId: thread.threadId },
    message: { chatId: "telegram", conversationId: thread.threadId, messageId: "1" },
    interactionId: "resume-session-1",
    actor: { kind: "user", actorId: "user-1", displayName: "Ishak", adapterData: {} },
    actionId: "r",
    value: "x",
    payload: `${input.harnessId}:${input.shortId}`,
  };
}

interface ActionButtonFixture {
  readonly actionId: string;
  readonly value: string;
  readonly payload?: unknown;
}

function encodedTelegramCallbackLength(button: ActionButtonFixture): number {
  return Buffer.byteLength(
    JSON.stringify({
      actionId: button.actionId,
      value: button.value,
      ...(button.payload === undefined ? {} : { payload: button.payload }),
    }),
    "utf8",
  );
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
