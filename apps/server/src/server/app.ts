import { Effect, FileSystem, Layer, Path } from "effect";
import type { SecretResolver } from "../config/resolve-secrets";
import { ServerConfigLive } from "../config/service";
import { LogReaderLive } from "../logging/log-reader";
import { ServerIdentity } from "../runtime/server-identity";
import { ShutdownCoordinatorLive } from "../runtime/shutdown-coordinator";
import { StatusRegistryLive } from "../runtime/status-registry";
import { ServerOptions, type NormalizedServerOptions } from "../options";
import { RuntimePathsLive } from "../runtime-state/runtime-paths-service";
import { ServerProbe } from "../runtime-state/server-probe";
import { ServerBinding } from "./binding";
import { serverMain } from "./main";

/** Platform services the shared server app needs before a host transport is bound. */
export type XmuxServerPlatform = FileSystem.FileSystem | Path.Path;

export interface XmuxServerAppProviders<RPlatformExtra = never> {
  /** Host platform primitives used by config, paths, logs, and runtime state. */
  readonly platform: Layer.Layer<XmuxServerPlatform | RPlatformExtra>;
  /** Secret source implementation. */
  readonly secrets: Layer.Layer<SecretResolver>;
  /** Stable identity for this server process/lifetime. */
  readonly identity: Layer.Layer<ServerIdentity>;
  /** Active-server probe implementation. */
  readonly probe: Layer.Layer<ServerProbe>;
  /** Host transport binding implementation. */
  readonly binding: Layer.Layer<ServerBinding>;
}

export interface XmuxServerAppOptions<RPlatformExtra = never> {
  readonly options: NormalizedServerOptions;
  readonly providers: XmuxServerAppProviders<RPlatformExtra>;
}

/** Pure app services that do not choose a host transport. */
export const makeCoreServices = <RPlatformExtra>(
  providers: Pick<XmuxServerAppProviders<RPlatformExtra>, "platform" | "secrets" | "probe">,
) => {
  const serverConfig = Layer.provide(
    ServerConfigLive,
    Layer.mergeAll(providers.platform, providers.secrets),
  );
  const logReader = Layer.provide(LogReaderLive, providers.platform);

  return Layer.mergeAll(
    StatusRegistryLive,
    ShutdownCoordinatorLive,
    serverConfig,
    logReader,
    providers.probe,
  );
};

/** Assemble the server app from host providers; hosts choose only the provider layers. */
export const make = <RPlatformExtra>(input: XmuxServerAppOptions<RPlatformExtra>) => {
  const options = Layer.succeed(ServerOptions)(input.options);
  const boot = Layer.mergeAll(input.providers.platform, options);
  const runtimePaths = Layer.provide(RuntimePathsLive, boot);
  const coreServices = makeCoreServices(input.providers);
  const layer = Layer.mergeAll(
    boot,
    runtimePaths,
    input.providers.identity,
    coreServices,
    input.providers.binding,
  );

  return {
    layer,
    main: serverMain().pipe(Effect.provide(layer)),
  };
};
