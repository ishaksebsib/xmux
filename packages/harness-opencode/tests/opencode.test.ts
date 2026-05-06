import { createOpencode } from "@opencode-ai/sdk/v2";
import { HarnessAdapterCreateSessionError, createHarness } from "@xmux/harness-core";
import { describe, expect, test } from "vitest";
import { createOpenCodeAdapter } from "../src";

describe("createOpenCodeAdapter", () => {
  test("creates a session against an embedded OpenCode runtime", async () => {
    const harness = createHarness({
      adapters: {
        opencode: createOpenCodeAdapter(),
      },
    });

    try {
      const created = await harness.createSession({
        harnessId: "opencode",
        cwd: process.cwd(),
        title: "xmux embedded session",
      });

      expect(created.isOk()).toBe(true);

      const session = created.unwrap("expected embedded OpenCode session to be created");
      expect(session.ref.harnessId).toBe("opencode");
      expect(session.title).toBe("xmux embedded session");
      expect(session.adapter.directory).toBe(process.cwd());
      expect(session.adapter.projectId.length).toBeGreaterThan(0);
      expect(session.adapter.slug.length).toBeGreaterThan(0);
      expect(session.adapter.version.length).toBeGreaterThan(0);
    } finally {
			//TODO: delete the sessions after the test
      await harness.close();
    }
  });

  test("creates a session against an external OpenCode runtime", async () => {
    const runtime = await createOpencode({ port: 0 });
    const harness = createHarness({
      adapters: {
        opencode: createOpenCodeAdapter({
          mode: "external",
          baseUrl: runtime.server.url,
        }),
      },
    });

    try {
      const created = await harness.createSession({
        harnessId: "opencode",
        cwd: process.cwd(),
        title: "xmux external session",
      });

      expect(created.isOk()).toBe(true);

      const session = created.unwrap("expected external OpenCode session to be created");
      expect(session.ref.harnessId).toBe("opencode");
      expect(session.title).toBe("xmux external session");
      expect(session.adapter.directory).toBe(process.cwd());
      expect(session.adapter.projectId.length).toBeGreaterThan(0);
      expect(session.adapter.slug.length).toBeGreaterThan(0);
    } finally {
      await harness.close();
      runtime.server.close();
    }
  });

  test("surfaces external runtime session creation failures", async () => {
    const harness = createHarness({
      adapters: {
        opencode: createOpenCodeAdapter({
          mode: "external",
          baseUrl: "http://127.0.0.1:1",
        }),
      },
    });

    try {
      const created = await harness.createSession({
        harnessId: "opencode",
        cwd: process.cwd(),
      });

      expect(created.isErr()).toBe(true);
      if (created.isErr()) {
        expect(created.error).toBeInstanceOf(HarnessAdapterCreateSessionError);
      }
    } finally {
      await harness.close();
    }
  });
});
