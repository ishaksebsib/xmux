# @xmux/store-sqlite

A local SQLite implementation of `@xmux/orchestrator`'s `Store`.

```ts
import { createXmux } from "@xmux/orchestrator";
import { createSqliteStore } from "@xmux/store-sqlite";

const xmux = createXmux({
  // config, harnesses, chats...
  store: createSqliteStore({ path: "/var/lib/xmux/xmux.db" }),
});

await xmux.initialize();
await xmux.shutdown();
```

Construction is synchronous and performs no I/O. The owning Xmux runtime opens
the database, applies PRAGMAs and package-owned migrations during
`initialize()`, then closes it during `shutdown()`. A store must belong to one
Xmux runtime lifetime and is not reopened after close. Expected startup,
migration, operation, and close failures are returned as typed Better Result
errors.

Advanced migration tooling is available from `@xmux/store-sqlite/migrations`;
normal consumers do not need it. `migrate({ path })` opens and closes its own
temporary client, so callers do not manage or pair separate client/path values.
