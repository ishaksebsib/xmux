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

describe("OpenCode prompt stream", () => {
  test("maps OpenCode events into harness prompt events", async () => {
    const promptCalls: unknown[] = [];
    const runtime = {
      client: {
        event: {
          subscribe: async () => ({
            stream: (async function* () {
              yield {
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
              };
              yield {
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
              };
              yield {
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
              };
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
      close: async () => undefined,
    } as unknown as OpenCodeRuntime;

    const prompted = await prompt(runtime, {
      ref: { harnessId: "opencode", sessionId: "session-1" },
      content: [{ type: "text", text: "hello" }],
      adapterOptions: {},
    });

    expect(prompted.isOk()).toBe(true);
    const events = await collectAsync(prompted.unwrap("prompt stream"));

    expect(promptCalls).toHaveLength(1);
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

  test("preserves core prompt content when calling OpenCode", async () => {
    const promptCalls: { readonly parts?: unknown[] }[] = [];
    const runtime = {
      client: {
        event: {
          subscribe: async () => ({
            stream: (async function* () {
              yield { type: "session.idle", properties: { sessionID: "session-1" } };
            })(),
          }),
        },
        session: {
          promptAsync: async (parameters: { readonly parts?: unknown[] }) => {
            promptCalls.push(parameters);
            return { error: undefined, response: { status: 204 } };
          },
        },
      },
      close: async () => undefined,
    } as unknown as OpenCodeRuntime;

    const prompted = await prompt(runtime, {
      ref: { harnessId: "opencode", sessionId: "session-1" },
      content: [
        { type: "text", text: "hello" },
        { type: "image", data: "aW1n", mimeType: "image/png", name: "image.png" },
        { type: "file", uri: "file:///tmp/a.txt", mime: "text/plain", name: "a.txt" },
      ],
      adapterOptions: {},
    });

    expect(prompted.isOk()).toBe(true);
    await collectAsync(prompted.unwrap("prompt stream"));

    expect(promptCalls[0]?.parts).toEqual([
      { type: "text", text: "hello" },
      { type: "file", mime: "image/png", filename: "image.png", url: "data:image/png;base64,aW1n" },
      { type: "file", mime: "text/plain", filename: "a.txt", url: "file:///tmp/a.txt" },
    ]);
  });
});
