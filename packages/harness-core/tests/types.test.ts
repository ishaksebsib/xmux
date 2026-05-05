import { Result } from "better-result";
import { expectTypeOf, test } from "vitest";
import { createHarness, defineHarnessAdapter, type CreatedSessionFor } from "../src";

const shouldRunTypeErrorChecks = process.argv.length === 0;

test("createSession narrows adapter options and results by harness id", () => {
  const harness = createHarness({
    adapters: {
      opencode: defineHarnessAdapter<"opencode", { workspaceId: string }, { workspaceId: string }>({
        id: "opencode",
        async open() {
          return Result.ok({
            id: "opencode" as const,
            async createSession(input: { adapterOptions: { workspaceId: string } }) {
              return Result.ok({
                sessionId: "ses_123",
                adapter: { workspaceId: input.adapterOptions.workspaceId },
              });
            },
            async close() {
              return undefined;
            },
          });
        },
      }),
      pi: defineHarnessAdapter<
        "pi",
        { sessionMode: "memory" | "persistent" },
        { sessionFile: string }
      >({
        id: "pi",
        async open() {
          return Result.ok({
            id: "pi" as const,
            async createSession(input: {
              adapterOptions: { sessionMode: "memory" | "persistent" };
            }) {
              return Result.ok({
                sessionId: "pi_123",
                adapter: {
                  sessionFile: `/tmp/${input.adapterOptions.sessionMode}.jsonl`,
                },
              });
            },
            async close() {
              return undefined;
            },
          });
        },
      }),
      defaultsOnly: defineHarnessAdapter<
        "defaultsOnly",
        { mode?: "safe" | "fast" },
        { mode: "safe" | "fast" }
      >({
        id: "defaultsOnly",
        async open() {
          return Result.ok({
            id: "defaultsOnly" as const,
            async createSession(input: { adapterOptions: { mode?: "safe" | "fast" } }) {
              return Result.ok({
                sessionId: "defaults-only-123",
                adapter: { mode: input.adapterOptions.mode ?? "safe" },
              });
            },
            async close() {
              return undefined;
            },
          });
        },
      }),
    },
  });

  expectTypeOf(harness.harnessIds).toEqualTypeOf<readonly ("defaultsOnly" | "opencode" | "pi")[]>();

  void harness.createSession({
    harnessId: "opencode",
    cwd: process.cwd(),
    adapterOptions: { workspaceId: "wrk_123" },
  });

  void harness.createSession({
    harnessId: "pi",
    cwd: process.cwd(),
    adapterOptions: { sessionMode: "persistent" },
  });

  void harness.createSession({
    harnessId: "defaultsOnly",
    cwd: process.cwd(),
  });

  void harness.createSession({
    harnessId: "defaultsOnly",
    cwd: process.cwd(),
    adapterOptions: { mode: "fast" },
  });

  type PiSession = CreatedSessionFor<
    {
      pi: ReturnType<
        typeof defineHarnessAdapter<
          "pi",
          { sessionMode: "memory" | "persistent" },
          { sessionFile: string }
        >
      >;
    },
    "pi"
  >;
  expectTypeOf({} as PiSession["adapter"]).toEqualTypeOf({ sessionFile: "" });

  const opencodePromise = harness.createSession({
    harnessId: "opencode",
    cwd: process.cwd(),
    adapterOptions: { workspaceId: "wrk_123" },
  });
  expectTypeOf(opencodePromise).toExtend<Promise<unknown>>();

  if (shouldRunTypeErrorChecks) {
    void harness.createSession({
      harnessId: "pi",
      cwd: process.cwd(),
      // @ts-expect-error opencode options must not be accepted by pi
      adapterOptions: { workspaceId: "wrk_123" },
    });

    void harness.createSession({
      harnessId: "opencode",
      cwd: process.cwd(),
      // @ts-expect-error pi options must not be accepted by opencode
      adapterOptions: { sessionMode: "memory" },
    });

    createHarness({
      adapters: {
        // @ts-expect-error adapter id must match its registration key
        pi: defineHarnessAdapter<"opencode", Record<never, never>, Record<never, never>>({
          id: "opencode",
          async open() {
            return Result.ok({
              id: "opencode" as const,
              async createSession() {
                return Result.ok({ sessionId: "bad", adapter: {} });
              },
              async close() {
                return undefined;
              },
            });
          },
        }),
      },
    });
  }
});
