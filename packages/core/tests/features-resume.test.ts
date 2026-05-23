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
    attachments: false,
  },
} as const;

const thread = { chatId: "telegram", threadId: "conversation-1" } as const;

describe("/resume command", () => {
  test("lists sessions from all harnesses with shortest unique ids per harness", async () => {
    const { emitCommand, replies, listInputs, xmux } = await initializeXmux();

    emitCommand(commandEvent({ options: { harnessId: undefined, shortId: undefined } }));

    await eventually(() => replies.length === 1);

    expect(listInputs).toEqual([
      { harnessId: "opencode", cwd: process.cwd() },
      { harnessId: "pi", cwd: process.cwd() },
    ]);
    expect(replies[0]).toContain("**Available sessions** (4)");
    expect(replies[0]).toContain("> **opencode** (3)");
    expect(replies[0]).toContain(
      "- Title: Fix bug\n  Short ID: `abc1`\n  Command: `/resume opencode abc1`",
    );
    expect(replies[0]).toContain("Short ID: `abc2`");
    expect(replies[0]).toContain("Title: Refactor auth");
    expect(replies[0]).toContain("Command: `/resume opencode abc2`");
    expect(replies[0]).toContain("Short ID: `xy9`");
    expect(replies[0]).toContain("Title: Cleanup");
    expect(replies[0]).toContain("Command: `/resume opencode xy9`");
    expect(replies[0]).toContain("> **pi** (1)");
    expect(replies[0]).toContain("Short ID: `abc`");
    expect(replies[0]).toContain("Title: PI session");
    expect(replies[0]).toContain("Command: `/resume pi abc`");

    await xmux.shutdown();
  });

  test("limits listed sessions per harness using the default resume config", async () => {
    const { emitCommand, replies, xmux } = await initializeXmux({
      opencodeSessions: createSessions("opencode", 6),
      piSessions: [],
    });

    emitCommand(commandEvent({ options: { harnessId: undefined, shortId: undefined } }));

    await eventually(() => replies.length === 1);

    expect(replies[0]).toContain("> **opencode** (showing 5 of 6)");
    expect(replies[0]).toContain("Title: opencode 5");
    expect(replies[0]).not.toContain("Title: opencode 6");
    expect(replies[0]).toContain("_And 1 more sessions._");

    await xmux.shutdown();
  });

  test("uses configured max resume sessions per harness", async () => {
    const { emitCommand, replies, xmux } = await initializeXmux({
      maxSessionsPerHarness: 2,
      opencodeSessions: createSessions("opencode", 4),
      piSessions: [],
    });

    emitCommand(commandEvent({ options: { harnessId: undefined, shortId: undefined } }));

    await eventually(() => replies.length === 1);

    expect(replies[0]).toContain("> **opencode** (showing 2 of 4)");
    expect(replies[0]).toContain("Title: opencode 2");
    expect(replies[0]).not.toContain("Title: opencode 3");
    expect(replies[0]).toContain("_And 2 more sessions._");

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
  const listInputs: { readonly harnessId: string; readonly cwd?: string }[] = [];
  const resumeInputs: {
    readonly harnessId: string;
    readonly sessionId: string;
    readonly cwd?: string;
  }[] = [];
  let emitCommand: ((event: unknown) => void) | undefined;

  const xmux = createXmux({
    harnesses: {
      opencode: defineHarnessAdapter<"opencode">({
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
      }),
      pi: defineHarnessAdapter<"pi">({
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
            async sendMessage(input) {
              return Result.ok(sentMessage({ text: input.text, format: input.format }));
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
      userName: "xmux",
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
    listInputs,
    resumeInputs,
    emitCommand: emitCommand as (event: unknown) => void,
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
