import { Result } from "better-result";
import { describe, expect, test } from "vitest";
import { defineChatAdapter } from "@xmux/chat-core";
import { defineHarnessAdapter } from "@xmux/harness-core";
import { createXmux } from "../src";
import { createSessionRecord, createThreadBinding, createThreadWorkspace } from "../src/store";

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
const activeRef = { harnessId: "opencode", sessionId: "abc111" } as const;

describe("/delete command", () => {
  test("deletes the active session and clears xmux routing state", async () => {
    const { emitCommand, replies, deleteInputs, xmux } = await initializeXmux();
    await bindActiveSession({ xmux });

    emitCommand(commandEvent({ options: { harnessId: undefined, shortId: undefined } }));

    await eventually(() => replies.length === 1);

    expect(deleteInputs).toEqual([{ harnessId: "opencode", sessionId: "abc111" }]);
    expect(replies[0]).toContain("**Deleted** `opencode/abc111`");
    expect(replies[0]).toContain("- Harness: `opencode`");
    expect(replies[0]).toContain("- Title: Fix bug");

    const session = await xmux.ctx.store.sessions.get(activeRef);
    expect(session.unwrap("expected session lookup to succeed")).toBeNull();

    const binding = await xmux.ctx.store.threadBindings.get(thread);
    expect(binding.unwrap("expected binding lookup to succeed")).toBeNull();

    await xmux.shutdown();
  });

  test("lists deletable sessions when no session is active", async () => {
    const { emitCommand, replies, listInputs, xmux } = await initializeXmux();

    emitCommand(commandEvent({ options: { harnessId: undefined, shortId: undefined } }));

    await eventually(() => replies.length === 1);

    expect(listInputs).toEqual([
      { harnessId: "opencode", cwd: process.cwd() },
      { harnessId: "pi", cwd: process.cwd() },
    ]);
    expect(replies[0]).toContain("**Available sessions** (4)");
    expect(replies[0]).toContain("Use `/delete <harnessId> <shortId>` to delete one.");
    expect(replies[0]).toContain("Command: `/delete opencode abc1`");
    expect(replies[0]).toContain("Command: `/delete pi abc`");

    await xmux.shutdown();
  });

  test("resolves a short id to the real session id and deletes it", async () => {
    const { emitCommand, replies, deleteInputs, xmux } = await initializeXmux();
    await bindActiveSession({ xmux, ref: { harnessId: "pi", sessionId: "abc999" } });

    emitCommand(commandEvent({ options: { harnessId: "opencode", shortId: "abc2" } }));

    await eventually(() => replies.length === 1);

    expect(deleteInputs).toEqual([{ harnessId: "opencode", sessionId: "abc222" }]);
    expect(replies[0]).toContain("**Deleted** `opencode/abc2`");
    expect(replies[0]).toContain("- Title: Refactor auth");

    const piBinding = await xmux.ctx.store.threadBindings.get(thread);
    expect(piBinding.unwrap("expected binding lookup to succeed")).toMatchObject({
      sessionRef: { harnessId: "pi", sessionId: "abc999" },
    });

    await xmux.shutdown();
  });

  test("uses the current thread cwd when listing explicit delete targets", async () => {
    const cwd = process.cwd();
    const { emitCommand, listInputs, deleteInputs, xmux } = await initializeXmux();
    await xmux.ctx.store.workspaces.set(
      createThreadWorkspace({ thread, cwd, now: new Date().toISOString() }),
    );

    emitCommand(commandEvent({ options: { harnessId: "pi", shortId: "abc" } }));

    await eventually(() => deleteInputs.length === 1);

    expect(listInputs).toContainEqual({ harnessId: "pi", cwd });
    expect(deleteInputs).toEqual([{ harnessId: "pi", sessionId: "abc999" }]);

    await xmux.shutdown();
  });

  test("reports a missing short id without deleting", async () => {
    const { emitCommand, replies, deleteInputs, xmux } = await initializeXmux();

    emitCommand(commandEvent({ options: { harnessId: "opencode", shortId: "missing" } }));

    await eventually(() => replies.length === 1);

    expect(deleteInputs).toHaveLength(0);
    expect(replies[0]).toContain("**Session not found**");
    expect(replies[0]).toContain("- Harness: `opencode`");
    expect(replies[0]).toContain("- Short ID: `missing`");

    await xmux.shutdown();
  });

  test("reports an unknown harness without deleting", async () => {
    const { emitCommand, replies, deleteInputs, xmux } = await initializeXmux();

    emitCommand(commandEvent({ options: { harnessId: "missing", shortId: "abc" } }));

    await eventually(() => replies.length === 1);

    expect(deleteInputs).toHaveLength(0);
    expect(replies[0]).toContain("**Error:** Unknown harness `missing`");
    expect(replies[0]).toContain("- `opencode`");
    expect(replies[0]).toContain("- `pi`");

    await xmux.shutdown();
  });

  test("reports ambiguous short ids instead of deleting", async () => {
    const { emitCommand, replies, deleteInputs, xmux } = await initializeXmux();

    emitCommand(commandEvent({ options: { harnessId: "opencode", shortId: "abc" } }));

    await eventually(() => replies.length === 1);

    expect(deleteInputs).toHaveLength(0);
    expect(replies[0]).toContain("**Short ID is ambiguous**");
    expect(replies[0]).toContain("- Harness: `opencode`");
    expect(replies[0]).toContain("`abc111`");
    expect(replies[0]).toContain("`abc222`");

    await xmux.shutdown();
  });

  test("reports an incomplete delete target", async () => {
    const { emitCommand, replies, xmux } = await initializeXmux();

    emitCommand(commandEvent({ options: { harnessId: "opencode", shortId: undefined } }));

    await eventually(() => replies.length === 1);

    expect(replies[0]).toContain("**Incomplete delete command**");
    expect(replies[0]).toContain("`/delete <harnessId> <shortId>`");

    await xmux.shutdown();
  });
});

interface SessionFixture {
  readonly sessionId: string;
  readonly title: string;
}

async function initializeXmux() {
  const replies: string[] = [];
  const listInputs: { readonly harnessId: string; readonly cwd?: string }[] = [];
  const deleteInputs: { readonly harnessId: string; readonly sessionId: string }[] = [];
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
              deleteInputs,
              sessions: [
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
              deleteInputs,
              sessions: [{ sessionId: "abc999", title: "PI session" }],
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
    },
  });

  expect((await xmux.initialize()).isOk()).toBe(true);
  expect(emitCommand).toBeDefined();

  return {
    replies,
    listInputs,
    deleteInputs,
    emitCommand: emitCommand as (event: unknown) => void,
    xmux,
  };
}

function createHarnessRuntime<const THarnessId extends "opencode" | "pi">(input: {
  readonly harnessId: THarnessId;
  readonly listInputs: { readonly harnessId: string; readonly cwd?: string }[];
  readonly deleteInputs: { readonly harnessId: string; readonly sessionId: string }[];
  readonly sessions: readonly SessionFixture[];
}) {
  return {
    id: input.harnessId,
    async createSession() {
      return Result.err(new Error("not implemented"));
    },
    async resumeSession() {
      return Result.err(new Error("not implemented"));
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
    async deleteSession(deleteInput: { readonly ref: { readonly sessionId: string } }) {
      input.deleteInputs.push({
        harnessId: input.harnessId,
        sessionId: deleteInput.ref.sessionId,
      });
      return input.sessions.some((session) => session.sessionId === deleteInput.ref.sessionId)
        ? Result.ok()
        : Result.err(new Error("missing session"));
    },
    async abort() {
      return Result.err(new Error("not implemented"));
    },
    close: async () => {},
  };
}

async function bindActiveSession(input: {
  readonly xmux: Awaited<ReturnType<typeof initializeXmux>>["xmux"];
  readonly ref?: typeof activeRef | { readonly harnessId: "pi"; readonly sessionId: "abc999" };
}) {
  const now = new Date().toISOString();
  const ref = input.ref ?? activeRef;
  const title = ref.harnessId === "opencode" ? "Fix bug" : "PI session";
  const record = createSessionRecord({
    ref,
    origin: thread,
    requester: { userId: "user-1" },
    cwd: process.cwd(),
    deliveryMode: "requester_only",
    title,
    now,
  });

  expect((await input.xmux.ctx.store.sessions.create(record)).isOk()).toBe(true);
  expect(
    (
      await input.xmux.ctx.store.threadBindings.bind(
        createThreadBinding({ thread, sessionRef: ref, now }),
      )
    ).isOk(),
  ).toBe(true);
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
      name: "delete",
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
