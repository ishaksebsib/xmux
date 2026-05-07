import { createHarness, type CreatedSessionFor } from "@xmux/harness-core";
import { expectTypeOf, test } from "vitest";
import {
  createOpenCodeAdapter,
  type OpenCodeCreateOptions,
  type OpenCodeSessionInfo,
} from "../src";

const shouldRunTypeErrorChecks = process.argv.length === 0;

test("adapter options stay optional and session metadata narrows", () => {
  const harness = createHarness({
    adapters: {
      opencode: createOpenCodeAdapter(),
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

  if (shouldRunTypeErrorChecks) {
    void harness.createSession({
      harnessId: "opencode",
      cwd: process.cwd(),
      // @ts-expect-error unknown OpenCode adapter option should not be accepted
      adapterOptions: { invalidOption: true },
    });
  }
});
