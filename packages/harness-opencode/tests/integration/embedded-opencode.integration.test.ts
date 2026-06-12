import { spawnSync } from "node:child_process";
import { createHarness } from "@xmux/harness-core";
import { describe, expect, test } from "vitest";
import { createOpenCodeAdapter } from "../../src";

function hasOpenCodeBinary(): boolean {
  const command = process.platform === "win32" ? "where opencode" : "command -v opencode";
  return (
    spawnSync(
      process.platform === "win32" ? "cmd" : "sh",
      [process.platform === "win32" ? "/c" : "-lc", command],
      { stdio: "ignore" },
    ).status === 0
  );
}

async function collectAsync<TValue>(iterable: AsyncIterable<TValue>): Promise<TValue[]> {
  const values: TValue[] = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values;
}

const shouldRunRealOpenCode = process.env.RUN_INTEGRATION === "true" && hasOpenCodeBinary();
const realOpenCodeTest = shouldRunRealOpenCode ? test : test.skip;

describe("createOpenCodeAdapter real OpenCode", () => {
  realOpenCodeTest("exercises all harness core methods against embedded OpenCode", async () => {
    const harness = createHarness({
      adapters: {
        opencode: createOpenCodeAdapter(),
      },
    });
    let createdRef: { readonly harnessId: "opencode"; readonly sessionId: string } | undefined;

    try {
      const created = await harness.createSession({
        harnessId: "opencode",
        cwd: process.cwd(),
        title: "xmux real opencode session",
      });
      expect(created.isOk()).toBe(true);
      const session = created.unwrap("expected embedded OpenCode session to be created");
      createdRef = session.ref;
      expect(session.ref.harnessId).toBe("opencode");
      expect(session.title).toBe("xmux real opencode session");
      expect(session.adapterData.directory).toBe(process.cwd());
      expect(session.adapterData.projectId.length).toBeGreaterThan(0);
      expect(session.adapterData.slug.length).toBeGreaterThan(0);
      expect(session.adapterData.version.length).toBeGreaterThan(0);

      const found = await harness.getSession({ ref: session.ref });
      expect(found.isOk()).toBe(true);
      expect(found.unwrap("expected getSession to find session")).toMatchObject({
        ref: session.ref,
        title: "xmux real opencode session",
      });

      const resumed = await harness.resumeSession({
        harnessId: "opencode",
        sessionId: session.ref.sessionId,
        cwd: process.cwd(),
      });
      expect(resumed.isOk()).toBe(true);
      expect(resumed.unwrap("expected resumeSession to find session")).toMatchObject({
        ref: session.ref,
        title: "xmux real opencode session",
      });

      const listed = await harness.listSessions({ harnessId: "opencode" });
      expect(listed.isOk()).toBe(true);
      expect(
        listed
          .unwrap("expected listSessions to succeed")
          .some((item) => item.ref.sessionId === session.ref.sessionId),
      ).toBe(true);

      const controller = new AbortController();
      controller.abort(new Error("skip real provider call"));
      const prompted = await harness.prompt({
        ref: session.ref,
        cwd: session.cwd,
        content: { type: "text", text: "hello" },
        signal: controller.signal,
      });
      expect(prompted.isOk()).toBe(true);
      const promptEvents = await collectAsync(prompted.unwrap("expected prompt stream"));
      expect(promptEvents.at(-1)).toMatchObject({
        type: "run",
        phase: "aborted",
        reason: "aborted",
      });

      const aborted = await harness.abort({ ref: session.ref });
      expect(aborted.isOk()).toBe(true);

      const deleted = await harness.deleteSession({ ref: session.ref });
      expect(deleted.isOk()).toBe(true);
      createdRef = undefined;
    } finally {
      if (createdRef) {
        await harness.deleteSession({ ref: createdRef });
      }
      await harness.close();
    }
  });
});
