import { Context } from "effect";

/** CLI-facing server options stay limited to product inputs. */
export interface RunXmuxServerOptions {
  /** Real product input from `xmux server run --foreground --config <path>`. */
  readonly configPath?: string;
}

/** Normalized options remove defaults once so services do not repeat fallback logic. */
export interface NormalizedServerOptions {
  readonly configPath?: string;
}

/** Normalized server options are a service so workflows can read them from context. */
export class ServerOptions extends Context.Service<ServerOptions, NormalizedServerOptions>()(
  "@xmux/server/ServerOptions",
) {}

/** Normalize at the boundary so downstream services receive explicit values. */
export const normalizeServerOptions = (
  options: RunXmuxServerOptions,
): NormalizedServerOptions => ({
  configPath: options.configPath,
});
