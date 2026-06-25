import { Effect, Layer } from "effect";
import { ServerBootConfig } from "../../config/boot";
import type { ServerManifest } from "../../contracts/manifest";
import type { BootConfigError, ManifestError, RuntimePathError } from "../../errors";
import { parseServerOptions, type RunXmuxServerOptions } from "../../options";
import {
  findActiveServerResult,
  type ActiveServerInfo,
  type InactiveServerReason,
} from "../../server-control/active-server";
import { readServerManifestResult } from "../../server-control/manifest";
import { resolveRuntimePaths, type ServerRuntimePaths } from "../../server-control/paths";
import { nodePlatformLayer } from "./layer";
import { nodeServerProbeLayer } from "./http/probe";

/** CLI-facing public alias for the server's resolved local scope paths. */
export type XmuxServerPaths = ServerRuntimePaths;

/** Public typed failures for Node discovery APIs. */
export type XmuxServerDiscoveryError = BootConfigError | RuntimePathError | ManifestError;

/** Defensive manifest read result with resolved scope paths attached. */
export type XmuxServerManifestDiscovery =
  | { readonly _tag: "NoManifest"; readonly paths: XmuxServerPaths }
  | {
      readonly _tag: "InvalidManifest";
      readonly paths: XmuxServerPaths;
      readonly reason: "invalid_json" | "invalid_manifest";
    }
  | {
      readonly _tag: "ValidManifest";
      readonly paths: XmuxServerPaths;
      readonly manifest: ServerManifest;
    };

/** Public active-server discovery result for local CLI control commands. */
export type XmuxServerDiscovery =
  | { readonly _tag: "Running"; readonly paths: XmuxServerPaths; readonly active: ActiveServerInfo }
  | {
      readonly _tag: "Stopped";
      readonly paths: XmuxServerPaths;
      readonly reason: InactiveServerReason;
    };

const nodePathResolutionLayer = Layer.mergeAll(nodePlatformLayer, ServerBootConfig.layer);
const nodeDiscoveryLayer = Layer.mergeAll(nodePathResolutionLayer, nodeServerProbeLayer);

/** Resolve the same runtime/control paths used by the foreground server. */
export const resolveXmuxServerPaths = (
  options: RunXmuxServerOptions,
): Effect.Effect<XmuxServerPaths, BootConfigError | RuntimePathError> =>
  resolveRuntimePaths(parseServerOptions(options)).pipe(Effect.provide(nodePathResolutionLayer));

/** Read and decode the scoped server manifest without trusting it as authority. */
export const readXmuxServerManifest = (
  options: RunXmuxServerOptions,
): Effect.Effect<XmuxServerManifestDiscovery, XmuxServerDiscoveryError> =>
  Effect.gen(function* () {
    const paths = yield* resolveRuntimePaths(parseServerOptions(options));
    const result = yield* readServerManifestResult(paths.manifestPath);

    switch (result._tag) {
      case "NoManifest": {
        const output: XmuxServerManifestDiscovery = { _tag: "NoManifest", paths };
        return output;
      }
      case "InvalidManifest": {
        const output: XmuxServerManifestDiscovery = {
          _tag: "InvalidManifest",
          paths,
          reason: result.reason,
        };
        return output;
      }
      case "ValidManifest": {
        const output: XmuxServerManifestDiscovery = {
          _tag: "ValidManifest",
          paths,
          manifest: result.manifest,
        };
        return output;
      }
    }
  }).pipe(Effect.provide(nodePathResolutionLayer));

/** Find an active server for the scoped config by probing the local control endpoint. */
export const findXmuxServer = (
  options: RunXmuxServerOptions,
): Effect.Effect<XmuxServerDiscovery, XmuxServerDiscoveryError> =>
  Effect.gen(function* () {
    const paths = yield* resolveRuntimePaths(parseServerOptions(options));
    const result = yield* findActiveServerResult(paths);

    if (result._tag === "Active") {
      const output: XmuxServerDiscovery = { _tag: "Running", paths, active: result.active };
      return output;
    }

    const output: XmuxServerDiscovery = { _tag: "Stopped", paths, reason: result.reason };
    return output;
  }).pipe(Effect.provide(nodeDiscoveryLayer));
