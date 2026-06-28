import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { Layer } from "effect";
import { ServerBootConfig } from "../../config/boot";
import type { ParsedServerOptions } from "../../options";
import { ServerOptions } from "../../options";
import { serverRuntimeLayer } from "../../server";
import { nodeHostRuntimeLayer } from "./host";
import { nodeSecretResolverLayer } from "./secrets";
import { nodeUnixSocketControlTransportLayer } from "./http/control-transport";
import { nodeServerProbeLayer } from "./http/probe";
import { nodeOrchestratorFactoryLayer } from "./orchestrator/factory";

/** Node platform primitives shared by the local server graph. */
export const nodePlatformLayer = Layer.mergeAll(
  nodeHostRuntimeLayer,
  NodeFileSystem.layer,
  NodePath.layer,
);

/** Production Node server layer. Construct once at the runtime boundary. */
export const makeNodeServerLayer = (options: ParsedServerOptions) => {
  const bootLayer = Layer.mergeAll(
    nodePlatformLayer,
    ServerBootConfig.layer,
    Layer.succeed(ServerOptions)(options),
  );
  const secretLayer = Layer.provideMerge(nodeSecretResolverLayer, bootLayer);
  const runtimeLayer = Layer.provideMerge(
    serverRuntimeLayer,
    Layer.mergeAll(secretLayer, nodeOrchestratorFactoryLayer),
  );
  const runtimeWithProbeLayer = Layer.mergeAll(runtimeLayer, nodeServerProbeLayer);

  return Layer.provideMerge(nodeUnixSocketControlTransportLayer, runtimeWithProbeLayer);
};
