import * as NodeServices from "@effect/platform-node/NodeServices";
import { Layer } from "effect";
import { ControlClient } from "./control/client";
import { ControlDiscovery } from "./control/discovery";
import { ProcessSpawner } from "./process/spawn";
import { LifecycleTiming } from "./process/wait";

export const cliServicesLayer = Layer.mergeAll(
  ControlDiscovery.layer,
  ControlClient.layer,
  ProcessSpawner.layer,
  LifecycleTiming.layer,
);
export const cliRuntimeLayer = Layer.mergeAll(NodeServices.layer, cliServicesLayer);
