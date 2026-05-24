import {
  createHarness,
  type CreatedSessionFor,
  type ListModelsResultFor,
} from "@xmux/harness-core";
import { expectTypeOf, test } from "vitest";
import {
  createOpenCodeAdapter,
  type OpenCodeCreateOptions,
  type OpenCodeModelInfo,
  type OpenCodeSessionInfo,
} from "../src";

const shouldRunTypeErrorChecks = process.argv.length === 0;

test("adapter options stay optional and session metadata narrows", () => {
  const harness = createHarness({
    adapters: {
      opencode: createOpenCodeAdapter({
        defaultModel: { providerId: "anthropic", modelId: "claude-sonnet-4-5" },
      }),
    },
  });

  void harness.createSession({
    harnessId: "opencode",
    cwd: process.cwd(),
  });

  void harness.createSession({
    harnessId: "opencode",
    cwd: process.cwd(),
    adapterOptions: {
      workspace: "default",
    },
  });

  void harness.listModels({
    harnessId: "opencode",
    adapterOptions: {
      workspace: "default",
    },
  });

  void harness.setModel({
    target: { type: "harness", harnessId: "opencode" },
    update: { type: "set", model: { providerId: "anthropic", modelId: "claude-sonnet-4-5" } },
  });

  void harness.getModel({
    target: { type: "session", ref: { harnessId: "opencode", sessionId: "session-1" } },
  });

  expectTypeOf<OpenCodeCreateOptions>().toEqualTypeOf<{
    readonly parentId?: string;
    readonly permission?: OpenCodeCreateOptions["permission"];
    readonly workspace?: string;
    readonly workspaceId?: string;
  }>();

  type OpenCodeSession = CreatedSessionFor<
    { opencode: ReturnType<typeof createOpenCodeAdapter> },
    "opencode"
  >;

  expectTypeOf({} as OpenCodeSession["adapterData"]).toEqualTypeOf<OpenCodeSessionInfo>();

  type OpenCodeModels = ListModelsResultFor<
    { opencode: ReturnType<typeof createOpenCodeAdapter> },
    "opencode"
  >;

  expectTypeOf({} as OpenCodeModels[number]["adapterData"]).toEqualTypeOf<OpenCodeModelInfo>();

  if (shouldRunTypeErrorChecks) {
    void harness.createSession({
      harnessId: "opencode",
      cwd: process.cwd(),
      // @ts-expect-error unknown OpenCode adapter option should not be accepted
      adapterOptions: { invalidOption: true },
    });
  }
});
