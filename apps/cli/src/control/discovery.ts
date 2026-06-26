import { Context, Effect } from "effect";
import {
  type CliResolvedServerPaths,
  type CliRunningServer,
  type CliServerDiscovery,
  type CliServerManifestDiscovery,
} from "../domain/discovery";
import { CliDiscoveryError, CliServerNotRunning } from "../domain/errors";
import type { CliServerTarget } from "../domain/input";

export interface ControlDiscoveryService {
  readonly resolvePaths: (
    target: CliServerTarget,
  ) => Effect.Effect<CliResolvedServerPaths, CliDiscoveryError>;
  readonly readManifest: (
    target: CliServerTarget,
  ) => Effect.Effect<CliServerManifestDiscovery, CliDiscoveryError>;
  readonly discover: (
    target: CliServerTarget,
  ) => Effect.Effect<CliServerDiscovery, CliDiscoveryError>;
  readonly requireRunning: (
    target: CliServerTarget,
  ) => Effect.Effect<CliRunningServer, CliDiscoveryError | CliServerNotRunning>;
}

export class ControlDiscovery extends Context.Service<ControlDiscovery, ControlDiscoveryService>()(
  "@xmux/cli/ControlDiscovery",
) {}
