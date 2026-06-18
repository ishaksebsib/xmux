import { Context, Effect } from "effect";

/** Clock seam keeps startup timestamps deterministic in lifecycle tests. */
export interface ServerClock {
  readonly now: () => Date;
}

/** Control endpoint overrides let tests avoid binding real local sockets. */
export type ServerControlEndpoint =
  | {
      readonly kind: "unix-socket";
      readonly path: string;
    }
  | {
      readonly kind: "test";
      readonly id: string;
    };

// TODO: review this
/** Path overrides are test seams; production paths are derived from config scope. */
export interface ServerPathOverrides {
  readonly stateDir?: string;
  readonly runtimeDir?: string;
  readonly logDir?: string;
  readonly dbPath?: string;
  readonly manifestPath?: string;
  readonly startupLockPath?: string;
}

// TODO: review this
/** CLI-facing server options stay small while leaving test seams explicit. */
export interface RunXmuxServerOptions {
  /** Real product input from `xmux server run --foreground --config <path>`. */
  readonly configPath?: string;
  /** Test/host seam for Phase 2 path resolution. */
  readonly pathOverrides?: ServerPathOverrides;
  /** Test/host seam for Phase 3 control binding. */
  readonly controlEndpointOverride?: ServerControlEndpoint;
  /** Test seam for deterministic timestamps. */
  readonly clock?: ServerClock;
  /**
   * Test and host seam for the long-lived foreground wait. The real server uses
   * a never-ending signal until Phase 3 wires control/signal shutdown.
   */
  readonly shutdownSignal?: Effect.Effect<void>;
}

/** Normalized options remove defaults once so services do not repeat fallback logic. */
export interface NormalizedServerOptions {
  readonly configPath?: string;
  readonly pathOverrides?: ServerPathOverrides;
  readonly controlEndpointOverride?: ServerControlEndpoint;
  readonly clock: ServerClock;
  readonly shutdownSignal: Effect.Effect<void>;
}

/** Normalized server options are a service so workflows can read them from context. */
export class ServerOptions extends Context.Service<ServerOptions, NormalizedServerOptions>()(
  "@xmux/server/ServerOptions",
) {}

/** System clock is the production default outside deterministic tests. */
export const SystemServerClock: ServerClock = {
  now: () => new Date(),
};

/** Normalize at the boundary so downstream services receive explicit values. */
export const normalizeServerOptions = (
  options: RunXmuxServerOptions,
): NormalizedServerOptions => ({
  configPath: options.configPath,
  pathOverrides: options.pathOverrides,
  controlEndpointOverride: options.controlEndpointOverride,
  clock: options.clock ?? SystemServerClock,
  shutdownSignal: options.shutdownSignal ?? Effect.never,
});
