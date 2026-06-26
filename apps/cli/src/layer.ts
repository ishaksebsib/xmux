import * as NodeServices from "@effect/platform-node/NodeServices";
import { Layer } from "effect";
import { ControlClient } from "./control/client";
import { ControlDiscovery } from "./control/discovery";

export const cliServicesLayer = Layer.mergeAll(ControlDiscovery.layer, ControlClient.layer);
export const cliRuntimeLayer = Layer.mergeAll(NodeServices.layer, cliServicesLayer);
