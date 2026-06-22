# `@xmux/server` Development Guide

## Purpose
`@xmux/server` is the local xmux runtime server. It loads config, owns local
server discovery/control state, exposes the local HTTP control API, writes safe
logs, and wires platform implementations at the outer edge.

## Design Principles
- Keep `server.ts` readable top-down: resolve paths, load config, bind control,
  publish manifest, mark ready, wait for shutdown.
- Keep business/runtime logic platform-neutral.
- Put Node/process/filesystem transport details under `platform/node/` only.
- Parse untrusted inputs through `Schema` contracts at boundaries.
- Prefer small capability modules over generic service buckets.
- Add abstractions only when ownership is clear or duplication is real.

## Source Shape
- `index.ts` is the platform-neutral root API.
- `server.ts` owns the main startup/shutdown workflow.
- `contracts/` owns boundary schemas and version constants only.
- `platform/host.ts` is the host/process port; `platform/node/` implements it.
- `server-control/` owns local discovery/control-plane state: paths, manifest,
  startup lock, control ports, and active-server checks.
- `server-runtime/` owns process lifecycle state: identity, status, shutdown.
- `config/` owns JSONC loading, effective config normalization, secret resolving,
  redaction, and the `ServerConfig` state service.
- `api/` owns HTTP contracts, route schemas, and handlers. No Node code here.
- `logging/` owns redacted file logging and bounded log reading.
- `errors.ts` owns schema-backed typed errors crossing server boundaries.

## Boundary Rules
- Nothing outside `platform/` may import Node APIs or `@effect/platform-node`.
- Domain modules may depend on `platform/host.ts` ports, not implementations.
- `contracts/` must not import runtime/config/platform modules.
- API handlers use services from context; they do not construct platform objects.
- Internal modules import concrete files, not broad barrels.
- Avoid folders named only by mechanism, like generic `services/`.

Keep lifecycle ownership and cleanup visible in this flow.

## Schema & Domain Modeling
- Put semantic scalars in `contracts/primitives.ts` as branded/refined schemas.
- Do not pass important IDs, paths, URLs, ports, timestamps, counts, or tokens as raw `string`/`number` past a boundary.
- Use `Schema.Class` for named records and tagged variants/unions for alternatives.
- Avoid boolean-plus-optional shapes when variants can make invalid states impossible.
- Decode unknown input and encode persisted/API/control/log payloads through Schema.

## Effect Config & Secrets
- Use Effect `Config` for env/runtime config; use `Config.schema` with branded schemas for validation.
- Keep JSONC product config Schema-decoded and separate from env/boot config services.
- Expose config through Context services/layers; tests should usually provide `Layer.succeed(...)` values.
- Use `Config.redacted` / `Redacted` for secrets and unwrap only at adapter edges.
- Do not keep raw secret strings in effective runtime config, logs, API responses, or errors.

## Export Rules
Root exports stay platform-neutral. Node-specific runtime/client exports belong
under `@xmux/server/platform/node`.
