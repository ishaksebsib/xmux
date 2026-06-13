import {
  createHarness,
  type CreatedSessionFor,
  type HarnessAdapterDefinition,
  type ListModelsResultFor,
} from "@xmux/harness-core";
import { expectTypeOf, test } from "vitest";
import {
  createPiAdapter,
  type PiAdapterConfig,
  type PiCreateOptions,
  type PiModelInfo,
  type PiSessionInfo,
} from "../../src";

const shouldRunTypeErrorChecks = process.argv.length === 0;

test("adapter options stay optional and adapter metadata narrows", () => {
  const adapter = createPiAdapter({
    defaultModel: { providerId: "anthropic", modelId: "claude-sonnet-4-5" },
  });

  expectTypeOf(adapter).toEqualTypeOf<
    HarnessAdapterDefinition<"pi", PiCreateOptions, PiSessionInfo, PiModelInfo>
  >();

  const harness = createHarness({
    adapters: {
      pi: adapter,
    },
  });

  void harness.createSession({
    harnessId: "pi",
    cwd: process.cwd(),
  });

  void harness.createSession({
    harnessId: "pi",
    cwd: process.cwd(),
    adapterOptions: {
      agentDir: "/tmp/pi-agent",
      sessionDir: "/tmp/pi-sessions",
      tools: ["read", "bash"],
      noTools: "builtin",
    },
  });

  void harness.listModels({
    harnessId: "pi",
    adapterOptions: {
      excludeTools: ["write"],
    },
  });

  void harness.setModel({
    target: { type: "harness", harnessId: "pi" },
    update: { type: "set", model: { providerId: "anthropic", modelId: "claude-sonnet-4-5" } },
  });

  void harness.getModel({
    target: { type: "session", ref: { harnessId: "pi", sessionId: "session-1" } },
  });

  expectTypeOf<PiCreateOptions>().toEqualTypeOf<{
    readonly agentDir?: string;
    readonly sessionDir?: string;
    readonly sessionPath?: string;
    readonly parentSession?: string;
    readonly tools?: readonly string[];
    readonly excludeTools?: readonly string[];
    readonly noTools?: "all" | "builtin";
  }>();

  expectTypeOf<PiAdapterConfig>().toMatchTypeOf<{
    readonly agentDir?: string;
    readonly sessionDir?: string;
  }>();

  type PiSession = CreatedSessionFor<{ pi: ReturnType<typeof createPiAdapter> }, "pi">;

  expectTypeOf({} as PiSession["adapterData"]).toEqualTypeOf<PiSessionInfo>();

  type PiModels = ListModelsResultFor<{ pi: ReturnType<typeof createPiAdapter> }, "pi">;

  expectTypeOf({} as PiModels[number]["adapterData"]).toEqualTypeOf<PiModelInfo>();

  if (shouldRunTypeErrorChecks) {
    void harness.createSession({
      harnessId: "pi",
      cwd: process.cwd(),
      // @ts-expect-error unknown Pi adapter option should not be accepted
      adapterOptions: { invalidOption: true },
    });
  }
});
