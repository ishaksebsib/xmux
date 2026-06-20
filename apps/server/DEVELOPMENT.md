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

## Export Rules
Root exports stay platform-neutral. Node-specific runtime/client exports belong
under `@xmux/server/platform/node`.
