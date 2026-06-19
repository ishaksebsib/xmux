import { Context, Effect, FileSystem, Scope } from "effect";
import type { ServerConfig } from "../config/service";
import type { ControlServerError } from "../errors";
import type { LogReader } from "../logging/log-reader";
import type { ServerIdentity } from "../runtime/server-identity";
import type { ShutdownCoordinator } from "../runtime/shutdown-coordinator";
import type { StatusRegistry } from "../runtime/status-registry";
import type { RuntimePaths } from "../runtime-state/runtime-paths-service";

export type ServerBindingContext =
  | Scope.Scope
  | FileSystem.FileSystem
  | RuntimePaths
  | ServerConfig
  | LogReader
  | ServerIdentity
  | ShutdownCoordinator
  | StatusRegistry;

/** Binds the API app to the host transport as a scoped resource. */
export class ServerBinding extends Context.Service<
  ServerBinding,
  {
    readonly bind: Effect.Effect<void, ControlServerError, ServerBindingContext>;
  }
>()("@xmux/server/ServerBinding") {}
