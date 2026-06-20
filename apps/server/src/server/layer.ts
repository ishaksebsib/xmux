import { Layer } from "effect";
import { ServerConfigLayer } from "../config/service";
import { LogReaderLayer } from "../logging/log-reader";
import { ServerIdentityLayer } from "../services/server-identity";
import { ShutdownCoordinatorLayer } from "../services/shutdown-coordinator";
import { StatusRegistryLayer } from "../services/status-registry";
import { RuntimePathsLayer } from "../runtime-state/runtime-paths-service";

/** Platform-neutral server services; host layers provide platform, secrets, probe, and transport. */
export const ServerRuntimeServices = Layer.mergeAll(
  RuntimePathsLayer,
  ServerConfigLayer,
  LogReaderLayer,
  ServerIdentityLayer,
  ShutdownCoordinatorLayer,
  StatusRegistryLayer,
);
