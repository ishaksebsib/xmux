import { Context, Effect } from "effect";

export interface HostRuntimeService {
  /** OS platform name used for host-specific branching. */
  readonly platform: string;
  /** Current user's home directory from the host environment. */
  readonly homeDir: string;
  /** Current process id for lifecycle ownership checks. */
  readonly pid: number;
  /** Current executable path for diagnostics and discovery metadata. */
  readonly executablePath: string;
  /** Environment lookup seam so callers avoid direct process.env access. */
  readonly getEnv: (name: string) => string | undefined;
  /** Host UUID generator for fresh opaque identifiers. */
  readonly randomUuid: () => Effect.Effect<string>;
  /** Host PID probe; only a stale-file hint, never ownership proof. */
  readonly isPidAlive: (pid: number) => Effect.Effect<boolean>;
  /** Last-resort host warning sink when normal logging is unsafe. */
  readonly emitWarning: (message: string) => Effect.Effect<void>;
}

/** Host process/environment operations used by otherwise platform-neutral server code. */
export class HostRuntime extends Context.Service<HostRuntime, HostRuntimeService>()(
  "@xmux/server/HostRuntime",
) {}
