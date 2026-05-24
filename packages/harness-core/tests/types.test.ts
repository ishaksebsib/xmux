import { Result } from "better-result";
import { expectTypeOf, test } from "vitest";
import {
  createHarness,
  defineHarnessAdapter,
  type AdapterAbortOptionsFor,
  type AdapterDeleteOptionsFor,
  type AdapterGetModelOptionsFor,
  type AdapterGetOptionsFor,
  type AdapterListModelsOptionsFor,
  type AdapterListOptionsFor,
  type AdapterModelFor,
  type AdapterPromptOptionsFor,
  type AdapterResumeOptionsFor,
  type AdapterSetModelOptionsFor,
  type AbortInput,
  type CreatedSessionFor,
  type DeleteSessionInput,
  type GetModelInput,
  type GetModelResultFromInput,
  type GetSessionInput,
  type HarnessAdapterPromptResult,
  type HarnessAdapterSessionInfo,
  type HarnessContentEvent,
  type HarnessModelInfo,
  type HarnessModelRef,
  type HarnessModelTarget,
  type HarnessModelUpdate,
  type HarnessPromptContent,
  type HarnessPromptEvent,
  type HarnessSessionInfo,
  type HarnessTokenUsage,
  type HarnessToolOutput,
  type ListModelsInput,
  type ListModelsResultFromInput,
  type ListSessionsInput,
  type PromptInput,
  type PromptResultFromInput,
  type ResumeSessionInput,
  type ResumeSessionResultFromInput,
  type SetModelInput,
  type SetModelResultFromInput,
  type SessionRef,
  type WorkingDirectoryPath,
} from "../src";

const shouldRunTypeErrorChecks = process.argv.length === 0;

function requiredHarnessMethods() {
  return {
    async resumeSession() {
      return Result.err(new Error("not implemented in type test"));
    },
    async listSessions() {
      return Result.err(new Error("not implemented in type test"));
    },
    async getSession() {
      return Result.err(new Error("not implemented in type test"));
    },
    async prompt() {
      return Result.err(new Error("not implemented in type test"));
    },
    async deleteSession() {
      return Result.err(new Error("not implemented in type test"));
    },
    async abort() {
      return Result.err(new Error("not implemented in type test"));
    },
  };
}

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
                adapterData: { workspaceId: input.adapterOptions.workspaceId },
              });
            },
            ...requiredHarnessMethods(),
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
                adapterData: {
                  sessionFile: `/tmp/${input.adapterOptions.sessionMode}.jsonl`,
                },
              });
            },
            ...requiredHarnessMethods(),
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
                adapterData: { mode: input.adapterOptions.mode ?? "safe" },
              });
            },
            ...requiredHarnessMethods(),
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
  expectTypeOf({} as PiSession["adapterData"]).toEqualTypeOf({ sessionFile: "" });

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
                return Result.ok({ sessionId: "bad", adapterData: {} });
              },
              ...requiredHarnessMethods(),
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

test("adapter session-control methods reuse createSession adapter options", () => {
  type OpenCodeOptions = { readonly workspaceId: string; readonly model?: "fast" | "smart" };

  const opencode = defineHarnessAdapter<
    "opencode",
    OpenCodeOptions,
    { readonly projectId: string }
  >({
    id: "opencode",
    async open() {
      return Result.ok({
        id: "opencode" as const,
        async createSession(input) {
          expectTypeOf(input.adapterOptions.workspaceId).toEqualTypeOf<string>();
          return Result.ok({
            sessionId: "opencode-1",
            adapterData: { projectId: input.adapterOptions.workspaceId },
          });
        },
        async resumeSession(input) {
          expectTypeOf(input.adapterOptions.workspaceId).toEqualTypeOf<string>();
          return Result.ok({
            sessionId: input.sessionId,
            adapterData: { projectId: input.adapterOptions.workspaceId },
          });
        },
        async listSessions(input) {
          expectTypeOf(input.adapterOptions.workspaceId).toEqualTypeOf<string>();
          return Result.ok([]);
        },
        async getSession(input) {
          expectTypeOf(input.adapterOptions.workspaceId).toEqualTypeOf<string>();
          expectTypeOf(input.ref.harnessId).toEqualTypeOf<"opencode">();
          return Result.ok({
            sessionId: input.ref.sessionId,
            adapterData: { projectId: input.adapterOptions.workspaceId },
          });
        },
        async prompt(input) {
          expectTypeOf(input.content).toEqualTypeOf<readonly HarnessPromptContent[]>();
          expectTypeOf(input.adapterOptions.model).toEqualTypeOf<"fast" | "smart" | undefined>();
          expectTypeOf(input.ref.harnessId).toEqualTypeOf<"opencode">();

          const events = (async function* (): HarnessAdapterPromptResult<"opencode"> {
            yield {
              type: "run",
              phase: "started",
              ref: input.ref,
            };
          })();

          return Result.ok(events);
        },
        async deleteSession(input) {
          expectTypeOf(input.adapterOptions.workspaceId).toEqualTypeOf<string>();
          return Result.ok(undefined);
        },
        async abort(input) {
          expectTypeOf(input.adapterOptions.workspaceId).toEqualTypeOf<string>();
          return Result.ok(undefined);
        },
        async close() {
          return undefined;
        },
      });
    },
  });

  const pi = defineHarnessAdapter<
    "pi",
    { readonly mode: "memory" },
    { readonly sessionFile: string }
  >({
    id: "pi",
    async open() {
      return Result.ok({
        id: "pi" as const,
        async createSession(input) {
          return Result.ok({
            sessionId: "pi-1",
            adapterData: { sessionFile: input.adapterOptions.mode },
          });
        },
        ...requiredHarnessMethods(),
        async close() {
          return undefined;
        },
      });
    },
  });

  const adapters = { opencode, pi };
  const harness = createHarness({ adapters });

  void harness.createSession({
    harnessId: "opencode",
    cwd: process.cwd(),
    adapterOptions: { workspaceId: "workspace-1", model: "fast" },
  });
  void harness.createSession({
    harnessId: "pi",
    cwd: process.cwd(),
    adapterOptions: { mode: "memory" },
  });

  expectTypeOf<
    AdapterResumeOptionsFor<typeof adapters, "opencode">
  >().toEqualTypeOf<OpenCodeOptions>();
  expectTypeOf<
    AdapterListOptionsFor<typeof adapters, "opencode">
  >().toEqualTypeOf<OpenCodeOptions>();
  expectTypeOf<
    AdapterGetOptionsFor<typeof adapters, "opencode">
  >().toEqualTypeOf<OpenCodeOptions>();
  expectTypeOf<
    AdapterPromptOptionsFor<typeof adapters, "opencode">
  >().toEqualTypeOf<OpenCodeOptions>();
  expectTypeOf<
    AdapterDeleteOptionsFor<typeof adapters, "opencode">
  >().toEqualTypeOf<OpenCodeOptions>();
  expectTypeOf<
    AdapterAbortOptionsFor<typeof adapters, "opencode">
  >().toEqualTypeOf<OpenCodeOptions>();
  expectTypeOf<AdapterPromptOptionsFor<typeof adapters, "pi">>().toEqualTypeOf<{
    readonly mode: "memory";
  }>();

  const adapterInfo = {
    sessionId: "native-session-1",
    cwd: process.cwd(),
    title: "Native session",
    adapterData: { projectId: "project-1" },
  } satisfies HarnessAdapterSessionInfo<{ readonly projectId: string }>;
  expectTypeOf(adapterInfo.cwd).toEqualTypeOf<string>();

  if (shouldRunTypeErrorChecks) {
    void harness.createSession({
      harnessId: "opencode",
      cwd: process.cwd(),
      // @ts-expect-error pi options must not be accepted by opencode
      adapterOptions: { mode: "memory" },
    });

    const invalidAdapterInfo = {
      sessionId: "native-session-1",
      // @ts-expect-error adapter-returned session info must use sessionId, not public ref
      ref: { harnessId: "opencode", sessionId: "native-session-1" },
      adapterData: { projectId: "project-1" },
    } satisfies HarnessAdapterSessionInfo<{ readonly projectId: string }>;
    void invalidAdapterInfo;
  }
});

test("public session-control input types narrow by harness id", () => {
  const adapters = {
    opencode: defineHarnessAdapter<
      "opencode",
      { readonly workspaceId: string; readonly model?: "fast" | "smart" },
      { readonly projectId: string }
    >({
      id: "opencode",
      async open() {
        return Result.ok({
          id: "opencode" as const,
          async createSession(input) {
            return Result.ok({
              sessionId: "opencode-1",
              adapterData: { projectId: input.adapterOptions.workspaceId },
            });
          },
          ...requiredHarnessMethods(),
          async close() {
            return undefined;
          },
        });
      },
    }),
    defaultsOnly: defineHarnessAdapter<
      "defaultsOnly",
      { readonly mode?: "safe" | "fast" },
      { readonly mode: "safe" | "fast" }
    >({
      id: "defaultsOnly",
      async open() {
        return Result.ok({
          id: "defaultsOnly" as const,
          async createSession(input) {
            return Result.ok({
              sessionId: "defaults-1",
              adapterData: { mode: input.adapterOptions.mode ?? "safe" },
            });
          },
          ...requiredHarnessMethods(),
          async close() {
            return undefined;
          },
        });
      },
    }),
  };

  const opencodeRef = {
    harnessId: "opencode",
    sessionId: "session-1",
  } satisfies SessionRef<"opencode">;

  const resume = {
    harnessId: "opencode",
    sessionId: "native-session-1",
    cwd: process.cwd(),
    adapterOptions: { workspaceId: "workspace-1", model: "smart" },
  } satisfies ResumeSessionInput<typeof adapters>;
  const list = {
    harnessId: "opencode",
    adapterOptions: { workspaceId: "workspace-1" },
  } satisfies ListSessionsInput<typeof adapters>;
  const get = {
    ref: opencodeRef,
    adapterOptions: { workspaceId: "workspace-1" },
  } satisfies GetSessionInput<typeof adapters>;
  const prompt = {
    ref: opencodeRef,
    cwd: process.cwd(),
    content: { type: "text", text: "hello" },
    adapterOptions: { workspaceId: "workspace-1", model: "fast" },
  } satisfies PromptInput<typeof adapters>;
  const promptMany = {
    ref: opencodeRef,
    cwd: process.cwd(),
    content: [
      { type: "text", text: "hello" },
      { type: "file", uri: "file:///tmp/a.ts", mime: "text/typescript" },
    ],
    adapterOptions: { workspaceId: "workspace-1" },
  } satisfies PromptInput<typeof adapters>;
  const deleteInput = {
    ref: opencodeRef,
    adapterOptions: { workspaceId: "workspace-1" },
  } satisfies DeleteSessionInput<typeof adapters>;
  const abort = {
    ref: opencodeRef,
    adapterOptions: { workspaceId: "workspace-1" },
  } satisfies AbortInput<typeof adapters>;
  const optionalOptionsList = {
    harnessId: "defaultsOnly",
  } satisfies ListSessionsInput<typeof adapters>;

  expectTypeOf(resume.adapterOptions.workspaceId).toEqualTypeOf<string>();
  expectTypeOf(list.adapterOptions.workspaceId).toEqualTypeOf<string>();
  expectTypeOf(get.ref.harnessId).toEqualTypeOf<"opencode">();
  expectTypeOf(prompt.content).toExtend<PromptInput<typeof adapters>["content"]>();
  expectTypeOf(promptMany.content).toExtend<PromptInput<typeof adapters>["content"]>();
  expectTypeOf(deleteInput.ref.sessionId).toEqualTypeOf<string>();
  expectTypeOf(abort.ref.sessionId).toEqualTypeOf<string>();
  expectTypeOf(optionalOptionsList.harnessId).toEqualTypeOf<"defaultsOnly">();
  expectTypeOf<
    ResumeSessionResultFromInput<typeof adapters, typeof resume>["adapterData"]
  >().toEqualTypeOf<{
    readonly projectId: string;
  }>();
  expectTypeOf<PromptResultFromInput<typeof adapters, typeof prompt>>().toEqualTypeOf<
    AsyncIterable<HarnessPromptEvent<"opencode">>
  >();

  if (shouldRunTypeErrorChecks) {
    // @ts-expect-error prompt input requires top-level cwd
    const badPrompt: PromptInput<typeof adapters> = {
      ref: opencodeRef,
      content: { type: "text", text: "hello" },
      adapterOptions: { workspaceId: "workspace-1" },
    };
    void badPrompt;

    const badGet = {
      ref: opencodeRef,
      // @ts-expect-error getSession input must not accept top-level cwd
      cwd: process.cwd(),
      adapterOptions: { workspaceId: "workspace-1" },
    } satisfies GetSessionInput<typeof adapters>;
    void badGet;

    const badResumeOptions = {
      harnessId: "opencode",
      sessionId: "native-session-1",
      // @ts-expect-error opencode session-control inputs require opencode adapter options
      adapterOptions: { mode: "safe" },
    } satisfies ResumeSessionInput<typeof adapters>;
    void badResumeOptions;
  }
});

test("model management input and output types narrow by harness id", () => {
  type OpenCodeModel = { readonly providerID: string; readonly modelID: string };
  const adapters = {
    opencode: defineHarnessAdapter<
      "opencode",
      { readonly workspaceId: string },
      { readonly projectId: string },
      OpenCodeModel
    >({
      id: "opencode",
      async open() {
        return Result.ok({
          id: "opencode" as const,
          async createSession(input) {
            expectTypeOf(input.model).toEqualTypeOf<HarnessModelRef | undefined>();
            return Result.ok({
              sessionId: "opencode-1",
              model: input.model,
              adapterData: { projectId: input.adapterOptions.workspaceId },
            });
          },
          ...requiredHarnessMethods(),
          async listModels(input) {
            expectTypeOf(input.adapterOptions.workspaceId).toEqualTypeOf<string>();
            expectTypeOf(input.includeUnavailable).toEqualTypeOf<boolean | undefined>();
            return Result.ok([
              {
                harnessId: "opencode",
                ref: { providerId: "anthropic", modelId: "claude-sonnet-4-5" },
                adapterData: { providerID: "anthropic", modelID: "claude-sonnet-4-5" },
              },
            ] satisfies readonly HarnessModelInfo<"opencode", OpenCodeModel>[]);
          },
          async getModel(input) {
            expectTypeOf(input.target).toEqualTypeOf<HarnessModelTarget<"opencode">>();
            return Result.ok({ target: input.target, source: "unset" as const });
          },
          async setModel(input) {
            expectTypeOf(input.update).toEqualTypeOf<HarnessModelUpdate>();
            return Result.ok({
              target: input.target,
              model: input.update.type === "set" ? input.update.model : undefined,
              source: input.update.type === "set" ? ("harness" as const) : ("unset" as const),
            });
          },
          async close() {
            return undefined;
          },
        });
      },
    }),
    pi: defineHarnessAdapter<"pi", { readonly mode: "memory" }, { readonly sessionFile: string }>({
      id: "pi",
      async open() {
        return Result.ok({
          id: "pi" as const,
          async createSession(input) {
            return Result.ok({
              sessionId: "pi-1",
              adapterData: { sessionFile: input.adapterOptions.mode },
            });
          },
          ...requiredHarnessMethods(),
          async close() {
            return undefined;
          },
        });
      },
    }),
  };

  const harness = createHarness({ adapters });
  const model = { providerId: "anthropic", modelId: "claude-sonnet-4-5" } satisfies HarnessModelRef;
  const opencodeRef = {
    harnessId: "opencode",
    sessionId: "session-1",
  } satisfies SessionRef<"opencode">;
  const listed = {
    harnessId: "opencode",
    includeUnavailable: true,
    adapterOptions: { workspaceId: "workspace-1" },
  } satisfies ListModelsInput<typeof adapters>;
  const got = {
    target: { type: "session", ref: opencodeRef },
    adapterOptions: { workspaceId: "workspace-1" },
  } satisfies GetModelInput<typeof adapters>;
  const set = {
    target: { type: "harness", harnessId: "opencode" },
    update: { type: "set", model },
    adapterOptions: { workspaceId: "workspace-1" },
  } satisfies SetModelInput<typeof adapters>;

  void harness.listModels(listed);
  void harness.getModel(got);
  void harness.setModel(set);

  expectTypeOf<AdapterModelFor<typeof adapters, "opencode">>().toEqualTypeOf<OpenCodeModel>();
  expectTypeOf<AdapterListModelsOptionsFor<typeof adapters, "opencode">>().toEqualTypeOf<{
    readonly workspaceId: string;
  }>();
  expectTypeOf<AdapterGetModelOptionsFor<typeof adapters, "opencode">>().toEqualTypeOf<{
    readonly workspaceId: string;
  }>();
  expectTypeOf<AdapterSetModelOptionsFor<typeof adapters, "opencode">>().toEqualTypeOf<{
    readonly workspaceId: string;
  }>();
  expectTypeOf<
    ListModelsResultFromInput<typeof adapters, typeof listed>[number]["adapterData"]
  >().toEqualTypeOf<OpenCodeModel>();
  expectTypeOf<GetModelResultFromInput<typeof adapters, typeof got>["target"]>().toEqualTypeOf<
    HarnessModelTarget<"opencode">
  >();
  expectTypeOf<SetModelResultFromInput<typeof adapters, typeof set>["source"]>().toEqualTypeOf<
    "session" | "harness" | "native" | "unset"
  >();

  if (shouldRunTypeErrorChecks) {
    const badList: ListModelsInput<typeof adapters> = {
      harnessId: "opencode",
      // @ts-expect-error opencode model inputs require opencode adapter options
      adapterOptions: { mode: "memory" },
    };
    void badList;

    // @ts-expect-error pi model inputs require pi adapter options
    const badGet: GetModelInput<typeof adapters> = {
      target: { type: "harness", harnessId: "pi" },
      adapterOptions: { workspaceId: "workspace-1" },
    };
    void badGet;
  }
});

test("shared harness operation data types are narrow and reusable", () => {
  const textContent = { type: "text", text: "hello" } satisfies HarnessPromptContent;
  const imageContent = {
    type: "image",
    data: "base64",
    mimeType: "image/png",
    name: "shot.png",
  } satisfies HarnessPromptContent;
  const fileContent = {
    type: "file",
    uri: "file:///tmp/example.txt",
    mime: "text/plain",
    description: "example",
  } satisfies HarnessPromptContent;

  expectTypeOf(textContent.type).toEqualTypeOf<"text">();
  expectTypeOf(imageContent.type).toEqualTypeOf<"image">();
  expectTypeOf(fileContent.type).toEqualTypeOf<"file">();

  const ref = { harnessId: "pi", sessionId: "session-1" } satisfies SessionRef<"pi">;
  const cwd = process.cwd() as WorkingDirectoryPath;
  const session = {
    ref,
    cwd,
    title: "Existing session",
    adapterData: { sessionFile: "/tmp/session.jsonl" },
  } satisfies HarnessSessionInfo<"pi", { readonly sessionFile: string }>;

  expectTypeOf(session.ref.harnessId).toEqualTypeOf<"pi">();
  expectTypeOf<
    HarnessSessionInfo<"pi", { readonly sessionFile: string }>["adapterData"]
  >().toEqualTypeOf<{
    readonly sessionFile: string;
  }>();

  const model = {
    providerId: "anthropic",
    modelId: "claude-sonnet-4-5",
    variant: "thinking",
  } satisfies HarnessModelRef;
  const usage = {
    input: 10,
    output: 20,
    reasoning: 3,
    cacheRead: 1,
    cacheWrite: 2,
    total: 36,
  } satisfies HarnessTokenUsage;
  const outputs = [
    { type: "text", text: "done" },
    { type: "image", data: "base64", mimeType: "image/png" },
    { type: "json", value: { ok: true } },
  ] satisfies readonly HarnessToolOutput[];

  expectTypeOf(model.modelId).toEqualTypeOf<string>();
  expectTypeOf(usage.total).toEqualTypeOf<number>();
  expectTypeOf<(typeof outputs)[number]>().toExtend<HarnessToolOutput>();

  if (shouldRunTypeErrorChecks) {
    // @ts-expect-error text prompt content requires text
    const invalidText = { type: "text" } satisfies HarnessPromptContent;
    void invalidText;

    // @ts-expect-error image prompt content requires mimeType
    const invalidImage = { type: "image", data: "base64" } satisfies HarnessPromptContent;
    void invalidImage;

    const invalidFile = {
      type: "file",
      uri: "file:///tmp/a",
      // @ts-expect-error file prompt content uses mime, not mimeType
      mimeType: "text/plain",
    } satisfies HarnessPromptContent;
    void invalidFile;
  }
});

test("neutral prompt events require phase-specific fields", () => {
  type PiEvent = HarnessPromptEvent<"pi", { readonly nativeId: string }>;
  const ref = { harnessId: "pi", sessionId: "session-1" } satisfies SessionRef<"pi">;

  const started = {
    type: "run",
    phase: "started",
    ref,
    adapterData: { nativeId: "run-1" },
  } satisfies PiEvent;
  const completed = {
    type: "run",
    phase: "completed",
    ref,
    reason: "stop",
    usage: { input: 1, output: 2, total: 3 },
  } satisfies PiEvent;
  const textDelta = {
    type: "content",
    phase: "delta",
    kind: "text",
    ref,
    messageId: "message-1",
    delta: "hello",
  } satisfies PiEvent;
  const toolCompleted = {
    type: "tool",
    phase: "completed",
    ref,
    callId: "call-1",
    output: [{ type: "text", text: "ok" }],
  } satisfies PiEvent;
  const native = {
    type: "native",
    ref,
    adapterData: { nativeId: "event-1" },
  } satisfies PiEvent;

  expectTypeOf(started.adapterData).toEqualTypeOf<{ nativeId: string }>();
  expectTypeOf(completed.reason).toEqualTypeOf<"stop">();
  expectTypeOf(textDelta.delta).toEqualTypeOf<string>();
  expectTypeOf(toolCompleted.output).toExtend<readonly HarnessToolOutput[]>();
  expectTypeOf(native.adapterData.nativeId).toEqualTypeOf<string>();

  type TextDelta = Extract<HarnessContentEvent<"pi">, { readonly phase: "delta" }>;
  expectTypeOf(textDelta).toExtend<TextDelta>();

  if (shouldRunTypeErrorChecks) {
    const failedRun = {
      type: "run",
      phase: "failed",
      ref,
      reason: "error",
      // @ts-expect-error failed run events require error
    } satisfies PiEvent;
    void failedRun;

    const badContentDelta = {
      type: "content",
      phase: "delta",
      kind: "text",
      ref,
      // @ts-expect-error content delta events require delta
    } satisfies PiEvent;
    void badContentDelta;

    const badContentCompleted = {
      type: "content",
      phase: "completed",
      kind: "text",
      ref,
      // @ts-expect-error completed content events require text
    } satisfies PiEvent;
    void badContentCompleted;

    const badToolFailed = {
      type: "tool",
      phase: "failed",
      ref,
      callId: "call-1",
      // @ts-expect-error failed tool events require error
    } satisfies PiEvent;
    void badToolFailed;

    const badNative = {
      type: "native",
      ref,
      // @ts-expect-error native events require adapterData
    } satisfies PiEvent;
    void badNative;
  }
});
