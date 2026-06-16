import { Effect } from "effect";

export interface ServerClock {
  readonly now: () => Date;
}

export type RunXmuxServerControlEndpoint =
  | {
      readonly kind: "unix-socket";
      readonly path: string;
    }
  | {
      readonly kind: "test";
      readonly id: string;
    };

export interface RunXmuxServerPathOverrides {
  readonly stateDir?: string;
  readonly runtimeDir?: string;
  readonly logDir?: string;
  readonly dbPath?: string;
  readonly manifestPath?: string;
  readonly startupLockPath?: string;
}

export interface RunXmuxServerOptions {
  /** Real product input from `xmux server run --foreground --config <path>`. */
  readonly configPath?: string;
  /** Test/host seam for Phase 2 path resolution. */
  readonly pathOverrides?: RunXmuxServerPathOverrides;
  /** Test/host seam for Phase 3 control binding. */
  readonly controlEndpointOverride?: RunXmuxServerControlEndpoint;
  /** Test seam for deterministic timestamps. */
  readonly clock?: ServerClock;
  /**
   * Test and host seam for the long-lived foreground wait. The real server uses
   * a never-ending signal until Phase 3 wires control/signal shutdown.
   */
  readonly shutdownSignal?: Effect.Effect<void>;
}

export interface NormalizedRunXmuxServerOptions {
  readonly configPath?: string;
  readonly pathOverrides?: RunXmuxServerPathOverrides;
  readonly controlEndpointOverride?: RunXmuxServerControlEndpoint;
  readonly clock: ServerClock;
  readonly shutdownSignal: Effect.Effect<void>;
}

export const SystemServerClock: ServerClock = {
  now: () => new Date(),
};

export const normalizeRunXmuxServerOptions = (
  options: RunXmuxServerOptions,
): NormalizedRunXmuxServerOptions => ({
  configPath: options.configPath,
  pathOverrides: options.pathOverrides,
  controlEndpointOverride: options.controlEndpointOverride,
  clock: options.clock ?? SystemServerClock,
  shutdownSignal: options.shutdownSignal ?? Effect.never,
});
