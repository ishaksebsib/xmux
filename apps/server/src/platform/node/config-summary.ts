import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Effect } from "effect";
import {
  loadConfiguredAdapterSummary,
  type ConfiguredAdapterSummary,
} from "../../config/adapter-summary";
import { configPathFromString } from "../../contracts/primitives";
const summaryLayer = NodeFileSystem.layer;

export const loadNodeConfiguredAdapterSummary = (
  configPath: string,
): Effect.Effect<ConfiguredAdapterSummary> =>
  loadConfiguredAdapterSummary(configPathFromString(configPath)).pipe(Effect.provide(summaryLayer));

export type { ConfiguredAdapterSummary };
