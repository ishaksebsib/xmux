# @xmux/harness-opencode

OpenCode adapter for `@xmux/harness-core`.

It supports embedded OpenCode runtimes and external OpenCode-compatible servers.

## Install

```sh
pnpm add @xmux/harness-opencode @xmux/harness-core
```

## Embedded Runtime

```ts
import { createHarness } from "@xmux/harness-core";
import { createOpenCodeAdapter } from "@xmux/harness-opencode";

const harness = createHarness({
  adapters: {
    opencode: createOpenCodeAdapter(),
  },
});

try {
  const session = await harness.createSession({
    harnessId: "opencode",
    cwd: process.cwd(),
    title: "xmux session",
  });
} finally {
  await harness.close();
}
```

## External Runtime

```ts
const harness = createHarness({
  adapters: {
    opencode: createOpenCodeAdapter({
      mode: "external",
      baseUrl: "http://127.0.0.1:4096",
    }),
  },
});
```

## Defaults

```ts
createOpenCodeAdapter({
  defaultModel: {
    providerId: "anthropic",
    modelId: "claude-sonnet-4-5",
  },
  defaultThinking: "medium",
});
```

## Prompt Streaming

```ts
const prompted = await harness.prompt({
  ref: { harnessId: "opencode", sessionId: "session-1" },
  cwd: process.cwd(),
  content: { type: "text", text: "Implement the next task" },
});

if (prompted.isOk()) {
  for await (const event of prompted.value) {
    console.log(event);
  }
}
```

Request failures after streaming starts are emitted as `run.failed` events. Setup failures, such as invalid model selection, are returned as `Result.err`.
