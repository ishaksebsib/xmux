# `@xmux/harness-core` Development Guide

## Purpose
`@xmux/harness-core` is the platform-agnostic harness runtime. It defines the
unified facade over coding-agent adapters, adapter contracts, session operations,
model/thinking controls, interaction responses, prompt streams, and typed errors.
It must not depend on a concrete harness adapter.

## Design Principles
- Keep the public API strongly typed, intentional, and stable.
- Keep `createHarness` top-down: derive ids, manage runtimes, wire handlers, close.
- Derive operation inputs/results from `TAdapters` and selected `harnessId`.
- Return expected failures as `Result<T, E>` values.
- Put platform-specific behavior behind adapter contracts.
- Prefer direct operation-specific handlers over generic dispatch abstractions.
- Add abstractions only when they clarify ownership or remove real duplication.

## Source Shape
- `index.ts` is the root public API.
- `contracts.ts` owns domain, adapter, and facade contracts until a split is useful.
- `types.ts` owns harness-id-based operation input/result derivation.
- `events.ts` owns normalized prompt event contracts.
- `errors.ts` owns public tagged errors and operation error unions.
- `harness.ts` owns the public facade construction and runtime cache orchestration.
- `runtime/` owns runtime policies such as prompt stream supervision.
- `handlers/` owns outbound operation implementations and adapter input mapping.

If a new concern does not clearly belong to one place, define the boundary before
adding a convenience file.

## Layer Boundaries
- Domain contracts must not import from handlers or runtime modules.
- Type derivation should depend on contracts/events, not handlers.
- Handlers may import contracts, types, errors, and runtime helpers.
- `harness.ts` may import lower layers and should only orchestrate.
- Runtime helpers own cross-operation runtime policy, not adapter-specific logic.
- Internal modules should import concrete files, not the root public barrel.
- Folder barrels are public domain boundaries, not internal shortcuts.

## Runtime Pattern
`createHarness(options)` should read top-down:

```text
createHarness(options)
  derive harness ids
  create runtime maps and in-flight open cache
  lazily open selected adapter runtimes
  wire operation handlers into the Harness facade
  close opened runtimes and aggregate close failures
  return the Harness facade
```

Runtime opening must dedupe concurrent first-use calls. `close()` must wait for
in-flight opens before closing opened runtimes.

## Handler Pattern
Each outbound operation should live in its own handler. Handlers should:
- validate facade inputs that core owns, such as working directories
- get the selected runtime
- build the adapter input explicitly
- call adapter methods through the shared adapter boundary helper
- map adapter failures to operation-specific public errors

Do not create a generic operation dispatcher. `invokeAdapter` is only for the
throwing/rejecting `Promise<Result<...>>` adapter boundary.

## Type And Error Safety
- Use focused aliases for repeated derivations.
- Cast only at real type boundaries.
- Do not introduce `as unknown as`, `as never`, or `as any`.
- Keep unavoidable casts localized and explain the invariant if it is load-bearing.
- Use `TaggedError` classes for exported error types and keep them distinct.
- Preserve `cause` when wrapping adapter or runtime failures.

## Export Rules
The package root exports public names only. Public API should serve consumers and
adapter authors, not expose every internal derivation helper. Keep useful generic
bounds public when downstream packages need them.

Desired code is idiomatic, safe, and boring: one concern per place, explicit control flow, strong public types, narrow casts, and no files kept only for convenience.
