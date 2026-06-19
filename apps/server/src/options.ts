import { Context, Effect } from "effect";

/** Clock seam keeps startup timestamps deterministic for hosts and tests. */
export interface ServerClock {
  readonly now: () => Date;
}

/** Local control endpoint. Windows named pipes should be added only with real transport support. */
export interface ServerControlEndpoint {
  readonly kind: "unix-socket";
  readonly path: string;
}

// TODO: review this
/** Path overrides are host seams; production paths are derived from config scope. */
export interface ServerPathOverrides {
  readonly stateDir?: string;
  readonly runtimeDir?: string;
  readonly logDir?: string;
  readonly dbPath?: string;
  readonly manifestPath?: string;
  readonly startupLockPath?: string;
}

// TODO: review this
/** CLI-facing server options stay small while leaving host seams explicit. */
export interface RunXmuxServerOptions {
  /** Real product input from `xmux server run --foreground --config <path>`. */
  readonly configPath?: string;
  /** Host seam for explicit path resolution. */
  readonly pathOverrides?: ServerPathOverrides;
  /** Host seam for selecting a non-default Unix socket path. */
  readonly controlEndpointOverride?: ServerControlEndpoint;
  /** Seam for deterministic timestamps in callers that need one. */
  readonly clock?: ServerClock;
  /**
   * Host seam for the long-lived foreground wait. The real server uses
   * a never-ending signal unless the embedding process supplies one.
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

/** System clock is the production default. */
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
