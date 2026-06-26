# `@xmux/cli` Development Guide

## Purpose
`@xmux/cli` is the user-facing local control adapter for xmux. It parses user
input, resolves the selected server scope, talks to the local control API,
spawns the foreground server command for detached lifecycle operations, and
renders concise output.

The CLI must stay thin. It must not construct product runtime pieces except for
the explicit foreground `server run --foreground` command.

## Design Principles
- Keep commands as adapters: parse input, call domain/control/process services,
  render output.
- Keep lifecycle decisions explicit and diagnosable: running, stopped, stale,
  invalid manifest, and wrong-scope states must not be collapsed.
- Parse untrusted CLI input into branded/refined domain values before IO.
- Preserve typed Effect error channels; map foreign/platform failures at adapter
  boundaries.
- Prefer small capability services over mega-services or generic helper buckets.
- Add abstractions only when ownership is clear and duplication is real.
- Never kill PIDs from CLI lifecycle commands; manifests are hints, not authority.

## Source Shape
- `src/index.ts` owns the platform-neutral command program exports.
- `src/commands/` owns command specs and handlers.
- `src/domain/` owns parsed inputs, discovery/lifecycle/status/logs models, and
  schema-backed CLI errors.
- `src/control/` owns control/discovery service contracts used by command logic.
- `src/process/` owns process/lifecycle contracts and pure spawn/readiness/wait
  planning.
- `src/output/` owns deterministic human/JSON formatting.
- `src/platform/node/` owns Node implementations: runtime wiring, server control
  client/discovery adapters, detached child-process spawning, foreground server
  runner, and process-level error reporting.

If a concern does not clearly belong to one folder, define the boundary first
instead of adding a convenience file.

## Boundary Rules
- Command modules must not import Node APIs or `@xmux/server/platform/node`.
- Domain and output modules must remain platform-neutral and mostly pure.
- Node/process/filesystem/runtime details belong under `platform/node/` only.
- `start` and `restart` spawn `xmux server run --foreground`; they must not call
  `runXmuxServer` or construct server runtime directly.
- Only `server run --foreground` may invoke the server foreground runner service.
- API clients, discovery, spawning, and foreground running are services provided
  by layers at the runtime boundary.
- Internal modules import concrete files, not broad package barrels.

## Output Rules
- Human output should be concise, deterministic, and secret-safe.
- JSON output is command-specific; do not add JSON mode to a lifecycle command
  unless the product plan says so.
- Include safe diagnostic paths/socket/session/PID fields when useful.
- Do not print raw config contents, bearer tokens, secret values, or unbounded
  causes by default. Debug rendering may show fuller Effect causes.
