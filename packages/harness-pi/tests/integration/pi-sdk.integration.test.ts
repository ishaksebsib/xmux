import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fauxAssistantMessage,
  registerFauxProvider,
  type FauxProviderRegistration,
} from "@earendil-works/pi-ai";
import { createHarness, type HarnessPromptEvent } from "@xmux/harness-core";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createPiAdapter } from "../../src";

let tempDir: string;
let registrations: FauxProviderRegistration[] = [];

const integrationTest = process.env.RUN_INTEGRATION === "true" ? test : test.skip;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "xmux-pi-integration-"));
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

async function registerIntegrationProvider() {
  const registration = registerFauxProvider({
    provider: "faux-integration",
    models: [
      { id: "fast", name: "Faux Integration Fast", reasoning: false, input: ["text"] },
      {
        id: "reasoning",
        name: "Faux Integration Reasoning",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 64000,
        maxTokens: 4096,
      },
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
          "faux-integration": {
            name: "Faux Integration Provider",
            api: registration.api,
            apiKey: "integration-test-key",
            baseUrl: "http://localhost:0",
            models: registration.models.map((model) => ({
              id: model.id,
              name: model.name,
              reasoning: model.reasoning,
              input: model.input,
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

async function collectPromptEvents(stream: AsyncIterable<HarnessPromptEvent<"pi">>) {
  const events: HarnessPromptEvent<"pi">[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("createPiAdapter Pi SDK integration", () => {
  integrationTest("exercises core lifecycle, model, thinking, and prompt operations", async () => {
    const provider = await registerIntegrationProvider();
    provider.setResponses([fauxAssistantMessage("integration response")]);

    const harness = createHarness({
      adapters: {
        pi: createPiAdapter({
          defaultModel: { providerId: "faux-integration", modelId: "fast" },
          defaultThinking: "medium",
        }),
      },
    });
    let createdRef: { readonly harnessId: "pi"; readonly sessionId: string } | undefined;

    try {
      const models = await harness.listModels({
        harnessId: "pi",
        includeUnavailable: true,
        adapterOptions: adapterOptions(),
      });
      expect(models.isOk()).toBe(true);
      expect(
        models
          .unwrap("models")
          .map((model) => model.ref)
          .filter((ref) => ref.providerId === "faux-integration"),
      ).toEqual([
        { providerId: "faux-integration", modelId: "fast" },
        { providerId: "faux-integration", modelId: "reasoning" },
      ]);

      const created = await harness.createSession({
        harnessId: "pi",
        cwd: process.cwd(),
        title: "xmux pi integration session",
        adapterOptions: adapterOptions(),
      });
      expect(created.isOk()).toBe(true);
      const session = created.unwrap("created session");
      createdRef = session.ref;
      expect(session.ref.harnessId).toBe("pi");
      expect(session.title).toBe("xmux pi integration session");
      expect(session.model).toEqual({ providerId: "faux-integration", modelId: "fast" });

      const selectedModel = await harness.setModel({
        target: { type: "session", ref: session.ref },
        update: { type: "set", model: { providerId: "faux-integration", modelId: "reasoning" } },
        adapterOptions: adapterOptions(),
      });
      expect(selectedModel.isOk()).toBe(true);
      expect(selectedModel.unwrap("selected model").model).toEqual({
        providerId: "faux-integration",
        modelId: "reasoning",
      });

      const selectedThinking = await harness.setThinking({
        target: { type: "session", ref: session.ref },
        update: { type: "set", level: "high" },
        adapterOptions: adapterOptions(),
      });
      expect(selectedThinking.isOk()).toBe(true);
      expect(selectedThinking.unwrap("selected thinking").level).toBe("high");

      const found = await harness.getSession({
        ref: session.ref,
        adapterOptions: adapterOptions(),
      });
      expect(found.isOk()).toBe(true);
      expect(found.unwrap("found session")).toMatchObject({ ref: session.ref });

      const resumed = await harness.resumeSession({
        harnessId: "pi",
        sessionId: session.ref.sessionId,
        cwd: process.cwd(),
        adapterOptions: adapterOptions(),
      });
      expect(resumed.isOk()).toBe(true);
      expect(resumed.unwrap("resumed session")).toMatchObject({ ref: session.ref });

      const listed = await harness.listSessions({
        harnessId: "pi",
        adapterOptions: adapterOptions(),
      });
      expect(listed.isOk()).toBe(true);
      expect(
        listed
          .unwrap("listed sessions")
          .some((item) => item.ref.sessionId === session.ref.sessionId),
      ).toBe(true);

      const prompted = await harness.prompt({
        ref: session.ref,
        cwd: process.cwd(),
        content: { type: "text", text: "Run the integration prompt" },
        adapterOptions: adapterOptions(),
      });
      expect(prompted.isOk()).toBe(true);
      const promptEvents = await collectPromptEvents(prompted.unwrap("prompt stream"));
      expect(promptEvents).toContainEqual(
        expect.objectContaining({
          type: "content",
          phase: "completed",
          kind: "text",
          text: "integration response",
        }),
      );
      expect(promptEvents.at(-1)).toMatchObject({ type: "run", phase: "completed" });

      const aborted = await harness.abort({ ref: session.ref, adapterOptions: adapterOptions() });
      expect(aborted.isOk()).toBe(true);

      const deleted = await harness.deleteSession({
        ref: session.ref,
        adapterOptions: adapterOptions(),
      });
      expect(deleted.isOk()).toBe(true);
      createdRef = undefined;
    } finally {
      if (createdRef) {
        await harness.deleteSession({ ref: createdRef, adapterOptions: adapterOptions() });
      }
      await harness.close();
    }
  });
});
