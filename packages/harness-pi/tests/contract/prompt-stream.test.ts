import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  registerFauxProvider,
  type FauxProviderRegistration,
} from "@earendil-works/pi-ai";
import { createHarness, type HarnessPromptEvent } from "@xmux/harness-core";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createPiAdapter } from "../../src";

let tempDir: string;
let registrations: FauxProviderRegistration[] = [];

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "xmux-pi-prompt-"));
});

afterEach(async () => {
  for (const registration of registrations) registration.unregister();
  registrations = [];
  await rm(tempDir, { recursive: true, force: true });
});

function paths() {
  return {
    agentDir: join(tempDir, "agent"),
    sessionDir: join(tempDir, "sessions"),
  };
}

function adapterOptions() {
  return {
    ...paths(),
    noTools: "all" as const,
  };
}

async function registerPromptModels() {
  const registration = registerFauxProvider({
    provider: "faux",
    models: [
      { id: "faux-fast", name: "Faux Fast", reasoning: false, input: ["text", "image"] },
      { id: "faux-reasoning", name: "Faux Reasoning", reasoning: true, input: ["text"] },
    ],
    tokensPerSecond: 0,
  });
  registrations.push(registration);

  const { agentDir } = paths();
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    join(agentDir, "models.json"),
    JSON.stringify(
      {
        providers: {
          faux: {
            name: "Faux Provider",
            api: registration.api,
            apiKey: "test-key",
            baseUrl: "http://localhost:0",
            models: registration.models.map((model) => ({
              id: model.id,
              name: model.name,
              reasoning: model.reasoning,
              input: model.input,
              thinkingLevelMap: model.thinkingLevelMap,
              contextWindow: model.contextWindow,
              maxTokens: model.maxTokens,
              cost: model.cost,
            })),
          },
        },
      },
      null,
      2,
    ),
  );

  return registration;
}

async function collectEvents(stream: AsyncIterable<HarnessPromptEvent<"pi">>) {
  const events: HarnessPromptEvent<"pi">[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("Pi prompt stream contract", () => {
  test("text prompt returns assistant text events and a completed run", async () => {
    const registration = await registerPromptModels();
    registration.setResponses([fauxAssistantMessage("hello from faux")]);
    const harness = createHarness({ adapters: { pi: createPiAdapter() } });

    try {
      const created = await harness.createSession({
        harnessId: "pi",
        cwd: process.cwd(),
        model: { providerId: "faux", modelId: "faux-fast" },
        adapterOptions: adapterOptions(),
      });
      expect(created.isOk()).toBe(true);

      const prompted = await harness.prompt({
        ref: created.unwrap("created").ref,
        cwd: process.cwd(),
        content: { type: "text", text: "Say hello" },
        adapterOptions: adapterOptions(),
      });
      expect(prompted.isOk()).toBe(true);

      const events = await collectEvents(prompted.unwrap("prompt stream"));
      expect(events[0]).toMatchObject({ type: "run", phase: "started" });
      expect(
        events.some(
          (event) => event.type === "content" && event.phase === "delta" && event.delta.length > 0,
        ),
      ).toBe(true);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "content",
          phase: "completed",
          kind: "text",
          text: "hello from faux",
        }),
      );
      expect(events.at(-1)).toMatchObject({ type: "run", phase: "completed", reason: "stop" });
    } finally {
      await harness.close();
    }
  });

  test("thinking and text chunks are mapped from Pi assistant events", async () => {
    const registration = await registerPromptModels();
    registration.setResponses([fauxAssistantMessage([fauxThinking("private reasoning"), fauxText("public answer")])]);
    const harness = createHarness({ adapters: { pi: createPiAdapter() } });

    try {
      const created = await harness.createSession({
        harnessId: "pi",
        cwd: process.cwd(),
        model: { providerId: "faux", modelId: "faux-reasoning" },
        thinking: "high",
        adapterOptions: adapterOptions(),
      });
      expect(created.isOk()).toBe(true);

      const prompted = await harness.prompt({
        ref: created.unwrap("created").ref,
        cwd: process.cwd(),
        content: { type: "text", text: "Think then answer" },
        adapterOptions: adapterOptions(),
      });
      expect(prompted.isOk()).toBe(true);

      const events = await collectEvents(prompted.unwrap("prompt stream"));
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "content",
          phase: "completed",
          kind: "reasoning",
          text: "private reasoning",
        }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "content",
          phase: "completed",
          kind: "text",
          text: "public answer",
        }),
      );
      expect(events.at(-1)).toMatchObject({ type: "run", phase: "completed" });
    } finally {
      await harness.close();
    }
  });

  test("unsupported file content returns a typed prompt content error", async () => {
    await registerPromptModels();
    const harness = createHarness({ adapters: { pi: createPiAdapter() } });

    try {
      const created = await harness.createSession({
        harnessId: "pi",
        cwd: process.cwd(),
        model: { providerId: "faux", modelId: "faux-fast" },
        adapterOptions: adapterOptions(),
      });
      expect(created.isOk()).toBe(true);

      const prompted = await harness.prompt({
        ref: created.unwrap("created").ref,
        cwd: process.cwd(),
        content: { type: "file", uri: "file:///tmp/example.txt", mime: "text/plain" },
        adapterOptions: adapterOptions(),
      });

      expect(prompted.isErr()).toBe(true);
      if (prompted.isErr()) {
        expect(JSON.stringify(prompted.error)).toContain("Invalid Pi prompt content");
      }
    } finally {
      await harness.close();
    }
  });
});
