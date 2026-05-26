import type { WorkingDirectoryPath } from "@xmux/harness-core";
import { describe, expect, test } from "vitest";
import { prompt } from "../src/handlers/prompt";
import type { OpenCodeRuntime } from "../src/runtime";

async function collectAsync<TValue>(iterable: AsyncIterable<TValue>): Promise<TValue[]> {
  const values: TValue[] = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values;
}

const cwd = process.cwd() as WorkingDirectoryPath;

function globalEvent(payload: unknown) {
  return { directory: cwd, payload };
}

describe("OpenCode prompt stream", () => {
  test("maps OpenCode events into harness prompt events", async () => {
    const promptCalls: unknown[] = [];
    const runtime = {
      client: {
        global: {
          event: async () => ({
            stream: (async function* () {
              yield globalEvent({
                type: "message.updated",
                properties: {
                  sessionID: "session-1",
                  info: {
                    id: "assistant-1",
                    sessionID: "session-1",
                    role: "assistant",
                    time: { created: 1 },
                    parentID: "user-1",
                    modelID: "model-1",
                    providerID: "provider-1",
                    mode: "build",
                    agent: "general",
                    path: { cwd: process.cwd(), root: process.cwd() },
                    cost: 0,
                    tokens: {
                      input: 1,
                      output: 0,
                      reasoning: 0,
                      cache: { read: 0, write: 0 },
                    },
                  },
                },
              });
              yield globalEvent({
                type: "message.part.updated",
                properties: {
                  sessionID: "session-1",
                  time: 2,
                  part: {
                    id: "part-1",
                    sessionID: "session-1",
                    messageID: "assistant-1",
                    type: "text",
                    text: "hello",
                    time: { start: 2 },
                  },
                },
              });
              yield globalEvent({
                type: "message.updated",
                properties: {
                  sessionID: "session-1",
                  info: {
                    id: "assistant-1",
                    sessionID: "session-1",
                    role: "assistant",
                    time: { created: 1, completed: 3 },
                    parentID: "user-1",
                    modelID: "model-1",
                    providerID: "provider-1",
                    mode: "build",
                    agent: "general",
                    path: { cwd: process.cwd(), root: process.cwd() },
                    cost: 0.01,
                    tokens: {
                      total: 4,
                      input: 1,
                      output: 3,
                      reasoning: 0,
                      cache: { read: 0, write: 0 },
                    },
                    finish: "stop",
                  },
                },
              });
            })(),
          }),
        },
        session: {
          promptAsync: async (parameters: unknown) => {
            promptCalls.push(parameters);
            return { error: undefined, response: { status: 204 } };
          },
        },
      },
      defaultModel: undefined,
      sessionModels: new Map(),
      close: async () => undefined,
    } as unknown as OpenCodeRuntime;

    const prompted = await prompt(runtime, {
      ref: { harnessId: "opencode", sessionId: "session-1" },
      cwd,
      content: [{ type: "text", text: "hello" }],
      adapterOptions: {},
    });

    expect(prompted.isOk()).toBe(true);
    const events = await collectAsync(prompted.unwrap("prompt stream"));

    expect(promptCalls).toHaveLength(1);
    expect(promptCalls[0]).toMatchObject({ directory: cwd });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "run", phase: "started" }),
        expect.objectContaining({ type: "message", phase: "started", role: "assistant" }),
        expect.objectContaining({ type: "content", phase: "delta", delta: "hello" }),
        expect.objectContaining({
          type: "run",
          phase: "completed",
          reason: "stop",
          usage: expect.objectContaining({ input: 1, output: 3, total: 4 }),
          cost: 0.01,
        }),
      ]),
    );
  });

  test("maps OpenCode session.next events into harness prompt events", async () => {
    const runtime = {
      client: {
        global: {
          event: async () => ({
            stream: (async function* () {
              yield globalEvent({
                type: "session.next.step.started",
                properties: {
                  timestamp: 1,
                  sessionID: "session-1",
                  agent: "build",
                  model: { providerID: "provider-next", id: "model-next", variant: "fast" },
                },
              });
              yield globalEvent({
                type: "session.next.text.started",
                properties: { timestamp: 2, sessionID: "session-1" },
              });
              yield globalEvent({
                type: "session.next.text.delta",
                properties: { timestamp: 3, sessionID: "session-1", delta: "hi" },
              });
              yield globalEvent({
                type: "session.next.text.ended",
                properties: { timestamp: 4, sessionID: "session-1", text: "hi" },
              });
              yield globalEvent({
                type: "session.next.tool.input.started",
                properties: { timestamp: 5, sessionID: "session-1", callID: "call-1", name: "read" },
              });
              yield globalEvent({
                type: "session.next.tool.input.delta",
                properties: { timestamp: 6, sessionID: "session-1", callID: "call-1", delta: "{}" },
              });
              yield globalEvent({
                type: "session.next.tool.called",
                properties: {
                  timestamp: 7,
                  sessionID: "session-1",
                  callID: "call-1",
                  tool: "read",
                  input: {},
                  provider: { executed: true },
                },
              });
              yield globalEvent({
                type: "session.next.tool.success",
                properties: {
                  timestamp: 8,
                  sessionID: "session-1",
                  callID: "call-1",
                  structured: {},
                  content: [{ type: "text", text: "done" }],
                  provider: { executed: true },
                },
              });
              yield globalEvent({
                type: "session.next.step.ended",
                properties: {
                  timestamp: 9,
                  sessionID: "session-1",
                  finish: "stop",
                  cost: 0.02,
                  tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
                },
              });
            })(),
          }),
        },
        session: {
          promptAsync: async () => ({ error: undefined, response: { status: 204 } }),
        },
      },
      defaultModel: undefined,
      sessionModels: new Map(),
      close: async () => undefined,
    } as unknown as OpenCodeRuntime;

    const prompted = await prompt(runtime, {
      ref: { harnessId: "opencode", sessionId: "session-1" },
      cwd,
      content: [{ type: "text", text: "hello" }],
      adapterOptions: {},
    });

    expect(prompted.isOk()).toBe(true);
    const events = await collectAsync(prompted.unwrap("prompt stream"));

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "turn", phase: "started", agent: "build" }),
        expect.objectContaining({ type: "content", phase: "delta", kind: "text", delta: "hi" }),
        expect.objectContaining({ type: "tool", phase: "completed", callId: "call-1" }),
        expect.objectContaining({ type: "run", phase: "completed", reason: "stop", cost: 0.02 }),
      ]),
    );
    expect(runtime.sessionModels.get("session-1")).toEqual({
      providerId: "provider-next",
      modelId: "model-next",
      variant: "fast",
    });
  });

  test("preserves core prompt content when calling OpenCode", async () => {
    const promptCalls: { readonly directory?: string; readonly parts?: unknown[] }[] = [];
    const runtime = {
      client: {
        global: {
          event: async () => ({
            stream: (async function* () {
              yield globalEvent({ type: "session.idle", properties: { sessionID: "session-1" } });
            })(),
          }),
        },
        session: {
          promptAsync: async (parameters: {
            readonly directory?: string;
            readonly parts?: unknown[];
          }) => {
            promptCalls.push(parameters);
            return { error: undefined, response: { status: 204 } };
          },
        },
      },
      defaultModel: undefined,
      sessionModels: new Map(),
      close: async () => undefined,
    } as unknown as OpenCodeRuntime;

    const prompted = await prompt(runtime, {
      ref: { harnessId: "opencode", sessionId: "session-1" },
      cwd,
      content: [
        { type: "text", text: "hello" },
        { type: "image", data: "aW1n", mimeType: "image/png", name: "image.png" },
        { type: "file", uri: "file:///tmp/a.txt", mime: "text/plain", name: "a.txt" },
      ],
      adapterOptions: {},
    });

    expect(prompted.isOk()).toBe(true);
    await collectAsync(prompted.unwrap("prompt stream"));

    expect(promptCalls[0]?.directory).toBe(cwd);
    expect(promptCalls[0]?.parts).toEqual([
      { type: "text", text: "hello" },
      { type: "file", mime: "image/png", filename: "image.png", url: "data:image/png;base64,aW1n" },
      { type: "file", mime: "text/plain", filename: "a.txt", url: "file:///tmp/a.txt" },
    ]);
  });
});
