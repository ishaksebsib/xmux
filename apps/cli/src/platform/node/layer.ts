import * as NodeServices from "@effect/platform-node/NodeServices";
import { Layer } from "effect";
import { LifecycleTiming } from "../../process/wait";
import { nodeConfigSummaryLayer } from "./config-summary";
import { nodeControlClientLayer } from "./control-client";
import { nodeControlDiscoveryLayer } from "./control-discovery";
import { nodePlatformSupportLayer } from "./platform-support";
import { nodeProcessSpawnerLayer } from "./process-spawner";
import { nodeServerRunnerLayer } from "./server-runner";
import { nodeStartLockLayer } from "./start-lock";
import { nodeCliOutputStyleLayer } from "./terminal";

const lifecycleTimingLayer = LifecycleTiming.layer;
const startLockLayer = nodeStartLockLayer.pipe(Layer.provide(lifecycleTimingLayer));

export const cliNodeServicesLayer = Layer.mergeAll(
  nodeControlDiscoveryLayer,
  nodeControlClientLayer,
  nodeConfigSummaryLayer,
  nodeProcessSpawnerLayer,
  nodeServerRunnerLayer,
  nodePlatformSupportLayer,
  nodeCliOutputStyleLayer,
  lifecycleTimingLayer,
  startLockLayer,
);

export const cliNodeRuntimeLayer = Layer.mergeAll(NodeServices.layer, cliNodeServicesLayer);
