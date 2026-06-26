import * as NodeServices from "@effect/platform-node/NodeServices";
import { Layer } from "effect";
import { LifecycleTiming } from "../../process/wait";
import { nodeControlClientLayer } from "./control-client";
import { nodeControlDiscoveryLayer } from "./control-discovery";
import { nodeProcessSpawnerLayer } from "./process-spawner";
import { nodeServerRunnerLayer } from "./server-runner";

export const cliNodeServicesLayer = Layer.mergeAll(
  nodeControlDiscoveryLayer,
  nodeControlClientLayer,
  nodeProcessSpawnerLayer,
  nodeServerRunnerLayer,
  LifecycleTiming.layer,
);

export const cliNodeRuntimeLayer = Layer.mergeAll(NodeServices.layer, cliNodeServicesLayer);
