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
