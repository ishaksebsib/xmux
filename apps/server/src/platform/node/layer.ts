import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Layer } from "effect";
import type { ParsedServerOptions } from "../../options";
import { ServerOptions } from "../../options";
import { ServerRuntimeServices } from "../../server";
import { NodeHostRuntime } from "./host";
import { NodeSecretResolver } from "./secrets";
import { NodeUnixSocketControlTransport } from "./http/control-transport";
import { NodeServerProbe } from "./http/probe";

/** Node platform primitives shared by the local server graph. */
export const NodePlatform = Layer.mergeAll(NodeHostRuntime, NodeFileSystem.layer, NodePath.layer);

/** Production Node server layer. Construct once at the runtime boundary. */
export const makeNodeServerLayer = (options: ParsedServerOptions) => {
  const boot = Layer.mergeAll(NodePlatform, Layer.succeed(ServerOptions)(options));
  const withSecrets = Layer.provideMerge(NodeSecretResolver, boot);
  const core = Layer.provideMerge(ServerRuntimeServices, withSecrets);
  const coreWithProbe = Layer.mergeAll(core, NodeServerProbe);

  return Layer.provideMerge(NodeUnixSocketControlTransport, coreWithProbe);
};
