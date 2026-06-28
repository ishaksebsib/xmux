import { Context, Effect } from "effect";
import {
  type CliResolvedServerPaths,
  type CliRunningServer,
  type CliServerDiscovery,
  type CliServerManifestDiscovery,
} from "../domain/discovery";
import { CliDiscoveryError, CliServerNotRunning, CliUnsupportedPlatform } from "../domain/errors";
import type { CliServerTarget } from "../domain/input";

export interface ControlDiscoveryService {
  readonly resolvePaths: (
    target: CliServerTarget,
  ) => Effect.Effect<CliResolvedServerPaths, CliDiscoveryError | CliUnsupportedPlatform>;
  readonly readManifest: (
    target: CliServerTarget,
  ) => Effect.Effect<CliServerManifestDiscovery, CliDiscoveryError | CliUnsupportedPlatform>;
  readonly discover: (
    target: CliServerTarget,
  ) => Effect.Effect<CliServerDiscovery, CliDiscoveryError | CliUnsupportedPlatform>;
  readonly requireRunning: (
    target: CliServerTarget,
  ) => Effect.Effect<
    CliRunningServer,
    CliDiscoveryError | CliServerNotRunning | CliUnsupportedPlatform
  >;
}

export class ControlDiscovery extends Context.Service<ControlDiscovery, ControlDiscoveryService>()(
  "@xmux/cli/ControlDiscovery",
) {}
