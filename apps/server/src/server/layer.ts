import { Layer } from "effect";
import { ServerConfigLayer } from "../config/service";
import { LogReaderLayer } from "../logging/log-reader";
import { ServerIdentityLayer } from "../runtime/server-identity";
import { ShutdownCoordinatorLayer } from "../runtime/shutdown-coordinator";
import { StatusRegistryLayer } from "../runtime/status-registry";
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
