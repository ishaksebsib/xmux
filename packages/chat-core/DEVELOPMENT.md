# `@xmux/chat-core` Development Guide

## Purpose
`@xmux/chat-core` is the platform-agnostic chat runtime. It defines adapter
contracts, registries, lifecycle, outbound operations, inbound events,
capability behavior, and typed errors. It must not depend on any platform
adapter.

## Design Principles
- Keep the public API strongly typed, intentional, and stable.
- Keep runtime flow explicit and readable from `runtime/create-chat.ts` down.
- Derive types from `TAdapters`, `TCommands`, and `TActions`.
- Return expected failures as `Result<T, E>` values.
- Put platform-specific behavior behind adapter contracts.
- Prefer direct operation-specific code over generic helpers that hide behavior.
- Add abstractions only when they clarify ownership or remove real duplication.

## Source Shape
- `index.ts` is the root public API.
- `contracts.ts`, `capabilities.ts`, and `type-utils.ts` are shared foundations.
- `inputs.ts`, `errors.ts`, and `lifecycle.ts` define facade inputs, failures,
  and runtime state rules.
- `adapter/` owns adapter-facing contracts, adapter I/O, and adapter derivation.
- `registry/` owns command/action registry definitions and helpers.
- `events/` owns event contracts plus the erased runtime event bus.
- `handlers/` owns outbound operation implementations and adapter-input mapping.
- `logger.ts` owns the public logger contract and typed log event names.
- `logger-utils.ts` owns safe log dispatch and reusable structured metadata
  helpers.
- `runtime/` owns `createChat`, top-level orchestration, and runtime aliases.

If a new concern does not clearly belong to one folder, define the boundary first
instead of creating a convenience file.

## Layer Boundaries
- Foundation modules must not import from domain, handler, or runtime modules.
- Domain contracts must not import from handlers or runtime.
- Handlers may import contracts, registries, adapter types, inputs, and errors.
- `runtime/create-chat.ts` may import lower layers and should only orchestrate.
- `events/bus.ts` works on erased `ChatEvent`; strong event generics belong at
  the facade boundary.
- Internal modules should import concrete files, not the root public barrel.
- Folder barrels are public domain boundaries, not internal shortcuts.

## Runtime Pattern
`runtime/create-chat.ts` should read top-down:

```text
createChat(options)
  derive chat ids and runtime state
  create the event bus
  create operation handlers
  bind adapter events into public chat events
  start adapters and flush startup events
  close adapters and aggregate close failures
  return the Chat facade
```

Keep lifecycle ownership, event binding, handler wiring, and cleanup visible.

## Event Pattern
Adapters emit `ChatAdapterEvent`. Runtime binds them into public `ChatEvent`
values before dispatch. Message and command-like events receive `reply`,
`replyStream`, and `typingIndicator`; action events receive `ack`, `reply`, and
`update`; other events pass through unchanged.

The bus owns subscription storage, event keying, dispatch, and handler-error
reporting. There should be one event-keying implementation.

## Handler Pattern
Each outbound operation should live in its own `createXHandler` factory. Handlers
receive dependencies explicitly and must not reach into runtime state.
`handlers/adapter-inputs.ts` maps facade inputs to adapter inputs;
`handlers/stream.ts` owns stream fallback utilities; `handlers/utils.ts` stays
small and must not become a re-export hub.

## Type And Error Safety
- Use focused aliases for repeated derivations.
- Cast only at real type boundaries.
- Do not introduce `as unknown as`, `as never`, or `as any`.
- Use `TaggedError` classes for exported error types and keep them distinct.
- Use `Result.tryPromise` at adapter boundaries that can throw or reject.
- Preserve `cause` when wrapping adapter or runtime failures.

## Export Rules
The package root exports public names only. Public domain barrels are allowed for
stable domains such as `adapter/index.ts` and `events/index.ts`. Do not export
handler helpers, event-bus helpers, adapter-input mappers, or runtime internals.

The desired code is idiomatic, safe, and boring: one concern per place, explicit
control flow, strong public types, narrow casts, and no files kept only for
convenience.
