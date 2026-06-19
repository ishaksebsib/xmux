import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Layer } from "effect";
import { SecretResolverLive } from "../../config/resolve-secrets";
import { ServerConfigLive } from "../../config/service";
import { LogReaderLive } from "../../logging/log-reader";
import type { NormalizedServerOptions } from "../../options";
import { ServerIdentityLive } from "../../runtime/server-identity";
import { ShutdownCoordinatorLive } from "../../runtime/shutdown-coordinator";
import { StatusRegistryLive } from "../../runtime/status-registry";
import { ServerProbeNodeLive } from "../../runtime-state/server-probe-node";
import * as XmuxServerApp from "../../server/app";
import { NodeUnixSocketBindingLive, nodeBinding } from "./http/server-binding";

/** Node platform services used by the shared server app. */
export const nodePlatform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

export const nodeProviders = {
  platform: nodePlatform,
  secrets: SecretResolverLive,
  identity: ServerIdentityLive,
  probe: ServerProbeNodeLive,
  binding: NodeUnixSocketBindingLive,
} satisfies XmuxServerApp.XmuxServerAppProviders;

/** Production Node app composition. This is the single injection point for the server. */
export const makeNodeXmuxServerApp = (options: NormalizedServerOptions) =>
  XmuxServerApp.make({ options, providers: nodeProviders });

export const makeNodeXmuxServerLayer = (options: NormalizedServerOptions) =>
  makeNodeXmuxServerApp(options).layer;

const serverConfig = Layer.provide(
  ServerConfigLive,
  Layer.mergeAll(nodePlatform, SecretResolverLive),
);
const logReader = Layer.provide(LogReaderLive, nodePlatform);

/** Compatibility/testing bundle for server tests that inject custom paths or bindings. */
export const nodeServerServices = Layer.mergeAll(
  StatusRegistryLive,
  ShutdownCoordinatorLive,
  serverConfig,
  logReader,
  ServerProbeNodeLive,
);

export { nodeBinding };
