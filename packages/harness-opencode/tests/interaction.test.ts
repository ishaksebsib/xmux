import type { WorkingDirectoryPath } from "@xmux/harness-core";
import { describe, expect, test } from "vitest";
import { OpenCodeInteractionRequestError, OpenCodeInteractionResponseError } from "../src/errors";
import { prompt } from "../src/handlers/prompt";
import { respondInteraction } from "../src/handlers/respond-interaction";
import type { OpenCodeRuntime } from "../src/runtime";

const ref = { harnessId: "opencode", sessionId: "session-1" } as const;
const cwd = process.cwd() as WorkingDirectoryPath;

async function collectAsync<TValue>(iterable: AsyncIterable<TValue>): Promise<TValue[]> {
  const values: TValue[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}

function globalEvent(payload: unknown) {
  return { directory: cwd, payload };
}

describe("OpenCode interaction response", () => {
  test("maps allow_once permission responses to once", async () => {
    const { runtime, calls } = createInteractionRuntime();

    const responded = await respondInteraction(runtime, {
      ref,
      cwd,
      response: { kind: "permission", requestId: "permission-1", decision: "allow_once" },
      adapterOptions: { workspace: "workspace-1" },
    });

    expect(responded.isOk()).toBe(true);
    expect(calls).toEqual([
      {
        target: "permission.reply",
        parameters: {
          requestID: "permission-1",
          directory: cwd,
          workspace: "workspace-1",
          reply: "once",
          message: undefined,
        },
      },
    ]);
  });

  test("maps allow_always permission responses to always", async () => {
    const { runtime, calls } = createInteractionRuntime();

    const responded = await respondInteraction(runtime, {
      ref,
      response: { kind: "permission", requestId: "permission-1", decision: "allow_always" },
      adapterOptions: {},
    });

    expect(responded.isOk()).toBe(true);
    expect(calls).toEqual([
      expect.objectContaining({
        target: "permission.reply",
        parameters: expect.objectContaining({ reply: "always" }),
      }),
    ]);
  });

  test("maps reject permission responses to reject", async () => {
    const { runtime, calls } = createInteractionRuntime();

    const responded = await respondInteraction(runtime, {
      ref,
      response: { kind: "permission", requestId: "permission-1", decision: "reject" },
      adapterOptions: {},
    });

    expect(responded.isOk()).toBe(true);
    expect(calls).toEqual([
      expect.objectContaining({
        target: "permission.reply",
        parameters: expect.objectContaining({ reply: "reject" }),
      }),
    ]);
  });

  test("maps question reject responses to question.reject", async () => {
    const { runtime, calls } = createInteractionRuntime();

    const responded = await respondInteraction(runtime, {
      ref,
      response: { kind: "question", requestId: "question-1", reject: true },
      adapterOptions: { workspace: "workspace-1" },
    });

    expect(responded.isOk()).toBe(true);
    expect(calls).toEqual([
      {
        target: "question.reject",
        parameters: { requestID: "question-1", directory: undefined, workspace: "workspace-1" },
      },
    ]);
  });

  test("maps question answer responses to question.reply", async () => {
    const { runtime, calls } = createInteractionRuntime();

    const responded = await respondInteraction(runtime, {
      ref,
      response: { kind: "question", requestId: "question-1", answers: [["Yes"], ["A", "B"]] },
      adapterOptions: { workspace: "workspace-1" },
    });

    expect(responded.isOk()).toBe(true);
    expect(calls).toEqual([
      {
        target: "question.reply",
        parameters: {
          requestID: "question-1",
          directory: undefined,
          workspace: "workspace-1",
          answers: [["Yes"], ["A", "B"]],
        },
      },
    ]);
  });

  test("wraps thrown SDK errors", async () => {
    const { runtime } = createInteractionRuntime({ thrown: new Error("network down") });

    const responded = await respondInteraction(runtime, {
      ref,
      response: { kind: "permission", requestId: "permission-1", decision: "allow_once" },
      adapterOptions: {},
    });

    expect(responded.isErr()).toBe(true);
    if (responded.isErr()) {
      expect(responded.error).toBeInstanceOf(OpenCodeInteractionRequestError);
      expect(responded.error.message).toContain("network down");
    }
  });

  test("wraps SDK response errors", async () => {
    const { runtime } = createInteractionRuntime({
      response: { error: { message: "not found" }, response: { status: 404 } },
    });

    const responded = await respondInteraction(runtime, {
      ref,
      response: { kind: "permission", requestId: "permission-1", decision: "allow_once" },
      adapterOptions: {},
    });

    expect(responded.isErr()).toBe(true);
    if (responded.isErr()) {
      expect(responded.error).toBeInstanceOf(OpenCodeInteractionResponseError);
      expect(responded.error.message).toContain("status 404");
      expect(responded.error.message).toContain("not found");
    }
  });
});

describe("OpenCode interaction prompt events", () => {
  test("maps permission requests with structured metadata", async () => {
    const runtime = createPromptRuntime([
      globalEvent({
        type: "permission.asked",
        properties: {
          id: "permission-1",
          sessionID: "session-1",
          permission: "bash",
          patterns: ["pnpm test", "pnpm lint"],
          metadata: { reason: "validation" },
          always: ["pnpm test"],
          tool: { messageID: "message-1", callID: "call-1" },
        },
      }),
      globalEvent({ type: "session.idle", properties: { sessionID: "session-1" } }),
    ]);

    const prompted = await prompt(runtime, {
      ref,
      cwd,
      content: [{ type: "text", text: "hello" }],
      adapterOptions: {},
    });

    expect(prompted.isOk()).toBe(true);
    const events = await collectAsync(prompted.unwrap("prompt stream"));

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "interaction",
          kind: "permission",
          phase: "requested",
          requestId: "permission-1",
          title: "bash",
          prompt: "bash: pnpm test, pnpm lint",
          metadata: { reason: "validation" },
          permission: {
            name: "bash",
            patterns: ["pnpm test", "pnpm lint"],
            tool: { messageId: "message-1", callId: "call-1" },
            allowAlways: true,
          },
        }),
      ]),
    );
  });

  test("maps question requests with structured metadata", async () => {
    const runtime = createPromptRuntime([
      globalEvent({
        type: "question.asked",
        properties: {
          id: "question-1",
          sessionID: "session-1",
          questions: [
            {
              header: "Mode",
              question: "Pick a mode",
              options: [{ label: "Fast", description: "Skip extra checks" }],
              multiple: false,
              custom: true,
            },
          ],
        },
      }),
      globalEvent({ type: "session.idle", properties: { sessionID: "session-1" } }),
    ]);

    const prompted = await prompt(runtime, {
      ref,
      cwd,
      content: [{ type: "text", text: "hello" }],
      adapterOptions: {},
    });

    expect(prompted.isOk()).toBe(true);
    const events = await collectAsync(prompted.unwrap("prompt stream"));

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "interaction",
          kind: "question",
          phase: "requested",
          requestId: "question-1",
          prompt: "Pick a mode",
          question: {
            questions: [
              {
                header: "Mode",
                question: "Pick a mode",
                options: [{ label: "Fast", description: "Skip extra checks" }],
                multiple: false,
                custom: true,
              },
            ],
          },
        }),
      ]),
    );
  });
});

function createInteractionRuntime(
  input: { readonly response?: unknown; readonly thrown?: unknown } = {},
) {
  const calls: { readonly target: string; readonly parameters: unknown }[] = [];
  const response = input.response ?? { data: true, response: { status: 200 } };

  const call = async (target: string, parameters: unknown) => {
    calls.push({ target, parameters });
    if (input.thrown !== undefined) throw input.thrown;
    return response;
  };

  return {
    calls,
    runtime: {
      client: {
        permission: {
          reply: (parameters: unknown) => call("permission.reply", parameters),
        },
        question: {
          reply: (parameters: unknown) => call("question.reply", parameters),
          reject: (parameters: unknown) => call("question.reject", parameters),
        },
      },
      sessionModels: new Map(),
      sessionThinking: new Map(),
      thinkingLevelMap: {},
      close: async () => undefined,
    } as unknown as OpenCodeRuntime,
  };
}

function createPromptRuntime(events: readonly unknown[]): OpenCodeRuntime {
  return {
    client: {
      global: {
        event: async () => ({ stream: toAsyncIterable(events) }),
      },
      session: {
        promptAsync: async () => ({ error: undefined, response: { status: 204 } }),
      },
    },
    sessionModels: new Map(),
    sessionThinking: new Map(),
    thinkingLevelMap: {},
    close: async () => undefined,
  } as unknown as OpenCodeRuntime;
}

async function* toAsyncIterable<TValue>(values: readonly TValue[]): AsyncIterable<TValue> {
  for (const value of values) yield value;
}
