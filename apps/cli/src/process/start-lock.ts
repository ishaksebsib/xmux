import { Context, Effect } from "effect";
import type { CliResolvedServerPaths } from "../domain/discovery";
import { CliStartLockError } from "../domain/errors";

export interface CliStartLockHandle {
  readonly path: string;
  readonly pid: number;
  readonly nonce: string;
  readonly scopeId: string;
}

export interface StartLockService {
  readonly acquire: (
    paths: CliResolvedServerPaths,
  ) => Effect.Effect<CliStartLockHandle, CliStartLockError>;
  readonly release: (lock: CliStartLockHandle) => Effect.Effect<void>;
  readonly withLock: <A, E, R>(
    paths: CliResolvedServerPaths,
    use: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | CliStartLockError, R>;
}

export class StartLock extends Context.Service<StartLock, StartLockService>()(
  "@xmux/cli/StartLock",
) {}
