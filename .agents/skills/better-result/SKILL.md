---
name: better-result
description: Use when writing or refactoring TypeScript error handling with better-result, Result, TaggedError, Result.gen, Result.tryPromise, or Result composition.
---

# Better Result

Use `better-result` for typed, explicit failure handling. Expected failures are `Result.err(...)`; thrown exceptions are for defects or external throwing boundaries.

Before broad refactors, read the local package source if available: `/home/pro/dev/forks/better-result/src/result.ts` and `/home/pro/dev/forks/better-result/src/error.ts`.

## Rules

- Return `Result<T, E>` or `Promise<Result<T, E>>` from fallible code.
- Use `TaggedError("Name")<Props>()` for domain and infrastructure errors.
- Use `Result.try` / `Result.tryPromise` only around code that can throw or reject.
- If an API already returns `Result`, compose it with `yield*`, `andThen`, `map`, `mapError`, `match`, or `flatten`.
- If an API returns `Promise<Result<T, E>>` and is trusted not to throw/reject, `await` it and compose the `Result` directly.
- Wrap `Promise<Result<T, E>>` with `Result.tryPromise` only at boundaries that may throw/reject despite returning `Result`.
- Do not manually unwrap nested results with `outer.value.isErr()` or helper functions like `unwrapResult`.
- Prefer `Result.gen` for multi-step flows.
- Preserve `cause` and structured context when mapping errors.
- Leave raw `try/finally` for cleanup/resource release; do not replace cleanup logic just to use Result.

## Errors

Define typed errors with useful runtime fields and a computed message when needed.

```ts
import { TaggedError } from "better-result";

class SessionNotFoundError extends TaggedError("SessionNotFoundError")<{
  readonly sessionId: string;
  readonly message: string;
}>() {
  constructor(args: { readonly sessionId: string }) {
    super({ ...args, message: `Session not found: ${args.sessionId}` });
  }
}

class AdapterRequestError extends TaggedError("AdapterRequestError")<{
  readonly operation: string;
  readonly cause: unknown;
  readonly message: string;
}>() {
  constructor(args: { readonly operation: string; readonly cause: unknown }) {
    super({ ...args, message: `Adapter ${args.operation} failed` });
  }
}
```

## Creating Results

Use direct `ok` / `err` for domain decisions.

```ts
function requireSession(session: Session | undefined): Result<Session, SessionNotFoundError> {
  return session === undefined
    ? Result.err(new SessionNotFoundError({ sessionId: "active" }))
    : Result.ok(session);
}
```

Use `tryPromise` at throwing/rejecting boundaries.

```ts
const response = await Result.tryPromise({
  try: () => client.request(input),
  catch: (cause) => new AdapterRequestError({ operation: "request", cause }),
});
```

If a trusted internal API returns `Promise<Result<T, AdapterError>>`, do not wrap it in `tryPromise` just to handle `Err`. Await it and map the `Result` directly.

```ts
const result = await chat.sendAction(input);

return Result.map(
  Result.mapError(result, (cause) => new CommandResponseError({ cause })),
  () => undefined,
);
```

If an untrusted boundary returns `Promise<Result<T, AdapterError>>` and may also throw/reject, compose both layers.

```ts
const outer = await Result.tryPromise({
  try: () => client.request(input),
  catch: (cause) => new AdapterRequestError({ operation: "request", cause }),
});

return Result.andThen(outer, (inner) =>
  Result.mapError(inner, (cause) => new AdapterRequestError({ operation: "request", cause })),
);
```

If both error layers are already valid, use `Result.flatten`.

```ts
const nested = await Result.tryPromise({
  try: () => handler(ctx), // Promise<Result<void, HandlerError>>
  catch: (cause) => new HandlerError({ cause }),
});

return Result.flatten(nested);
```

## Composition

Use `Result.gen` for dependent steps. Yield sync Results directly and wrap Promise<Result> with `Result.await`.

```ts
async function createSession(input: Input): Promise<Result<SessionRecord, CreateError>> {
  return Result.gen(async function* () {
    const harnessId = yield* requireHarness(input.harnessId);
    const cwd = yield* Result.await(getCurrentCwd(input.thread));
    const session = yield* Result.await(openSession({ harnessId, cwd }));
    yield* Result.await(storeSession(session));
    return Result.ok(session);
  });
}
```

Use `andThen` for one dependent step.

```ts
return Result.andThen(parseSelector(selector), (parsed) => resolveModel(parsed, models));
```

Use `map` for success transforms and `mapError` for error normalization.

```ts
return Result.mapError(adapterResult, (cause) => new CommandResponseError({ cause }));
```

Use `match` at formatting/UI boundaries or when changing shape based on success/error.

```ts
const message = Result.match(result, {
  ok: (value) => formatSuccess(value),
  err: (error) => formatFailure(error),
});
```

## Anti-Patterns

Do not unwrap nested Results manually.

```ts
// Bad
if (outer.isErr()) return Result.err(outer.error);
if (outer.value.isErr()) return Result.err(mapError(outer.value.error));
return Result.ok();
```

```ts
// Good
return Result.andThen(outer, (inner) =>
  Result.map(Result.mapError(inner, mapError), () => undefined),
);
```

Do not wrap sync Results in `Promise.resolve` just to use `Result.await`.

```ts
// Bad
const value = yield* Result.await(Promise.resolve(Result.mapError(result, mapError)));
```

```ts
// Good
const value = yield* Result.mapError(result, mapError);
```

Do not bind unused values just to validate/sequence.

```ts
// Bad
const deleted = yield* Result.await(deleteSession(ref));
```

```ts
// Good
yield* Result.await(deleteSession(ref));
```

Do not use `try/catch` for expected failures.

```ts
// Bad
try {
  return Result.ok(await client.send(input));
} catch (cause) {
  return Result.err(new SendError({ cause }));
}
```

```ts
// Good
return Result.tryPromise({
  try: () => client.send(input),
  catch: (cause) => new SendError({ cause }),
});
```

Do not wrap trusted `Promise<Result>` APIs with `tryPromise` just to map their `Err`.

```ts
// Bad for trusted internal APIs
const outer = await Result.tryPromise({
  try: () => chat.sendAction(input),
  catch: (cause) => new CommandResponseError({ cause }),
});

return Result.andThen(outer, (inner) =>
  Result.mapError(inner, (cause) => new CommandResponseError({ cause })),
);
```

```ts
// Good
const result = await chat.sendAction(input);
return Result.mapError(result, (cause) => new CommandResponseError({ cause }));
```

## Raw Try/Catch Exceptions

Raw `try` is acceptable for:

- `try/finally` resource release.
- async iterator cleanup where streams must be completed.
- best-effort stringify/serialization fallback helpers.
- tests that assert thrown behavior.

## Checklist

- Domain failures return `Result.err`, not `throw`.
- External throwing boundaries use `Result.try` or `Result.tryPromise`.
- Trusted `Promise<Result<...>>` APIs are awaited and composed directly.
- Untrusted throwing/rejecting `Promise<Result<...>>` boundaries are wrapped with `Result.tryPromise`, then composed with `andThen`, `flatten`, or `mapError`.
- `Promise<Result<...>>` values are composed with `Result.await` in `Result.gen` when inside a generator.
- Sync `Result` values are yielded directly in `Result.gen`.
- Nested Result layers are handled with `andThen`, `flatten`, or `mapError`, not manual `.value.isErr()` checks.
- Error mapping preserves `cause` and identifying fields.
- Tests and typecheck pass.
