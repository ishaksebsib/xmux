# Server API layout

Each route group is self-contained:

```txt
groups/<feature>/
  schemas.ts   request/response/error schemas owned by the endpoint group
  api.ts       HttpApiGroup endpoint contract
  handlers.ts  HttpApiBuilder.group implementation
  index.ts     public re-exports for tests and clients
```

Registration is intentionally centralized in two small files:

- `api.ts` adds each group contract to `serverApi`.
- `registry.ts` merges each group handler layer.

To add a route group, create `groups/<feature>/*`, then add one import in each of those files. Keep Node/platform code out of groups; use services from context instead.

OpenAPI is generated from the same `serverApi` contract via `openapi.ts`.

This directory stays platform-agnostic: it owns the HTTP contract, schemas, and handlers only. Node-specific client transport lives under `platform/node/http/client.ts` and is exported only from `@xmux/server/platform/node`.

Create the Node xmux server from the platform entrypoint:

```ts
import { Effect } from "effect";
import { runXmuxServer } from "@xmux/server/platform/node";

await Effect.runPromise(
  runXmuxServer({ configPath: "/etc/xmux/config.jsonc" }),
);
```

Typed Node local clients are used like this:

```ts
import { Effect } from "effect";
import { createXmuxClient } from "@xmux/server/platform/node";

const health = Effect.scoped(
  Effect.gen(function* () {
    const client = yield* createXmuxClient({ socketPath: "/run/xmux/server.sock" });
    return yield* client.system.health();
  }),
);
```
