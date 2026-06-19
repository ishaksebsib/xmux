import { Context } from "effect";

/** CLI-facing server options stay limited to product inputs. */
export interface RunXmuxServerOptions {
  /** Real product input from `xmux server run --foreground --config <path>`. */
  readonly configPath?: string;
}

/** Parsed options represent checked public inputs before filesystem defaults are resolved. */
export interface ParsedServerOptions {
  readonly configPath?: string;
}

/** @deprecated Use ParsedServerOptions. */
export type NormalizedServerOptions = ParsedServerOptions;

/** Parsed server options are a service so workflows can read them from context. */
export class ServerOptions extends Context.Service<ServerOptions, ParsedServerOptions>()(
  "@xmux/server/ServerOptions",
) {}

/** Parse at the boundary so downstream services receive explicit values. */
export const parseServerOptions = (options: RunXmuxServerOptions): ParsedServerOptions => ({
  configPath: options.configPath,
});

/** @deprecated Use parseServerOptions. */
export const normalizeServerOptions = parseServerOptions;
