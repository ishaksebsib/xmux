import { Config, Context, Effect, Layer, Option } from "effect";
import { BootConfigError } from "../errors";
import { ResolvedPath } from "../contracts/primitives";

export interface ServerBootConfigService {
  readonly xdgConfigHome: Option.Option<ResolvedPath>;
  readonly xdgStateHome: Option.Option<ResolvedPath>;
  readonly xdgRuntimeDir: Option.Option<ResolvedPath>;
}

export class ServerBootConfig extends Context.Service<ServerBootConfig, ServerBootConfigService>()(
  "@xmux/server/ServerBootConfig",
) {
  static readonly layer = Layer.effect(
    ServerBootConfig,
    Effect.gen(function* () {
      const xdgConfigHome = yield* Config.option(Config.schema(ResolvedPath, "XDG_CONFIG_HOME"));
      const xdgStateHome = yield* Config.option(Config.schema(ResolvedPath, "XDG_STATE_HOME"));
      const xdgRuntimeDir = yield* Config.option(Config.schema(ResolvedPath, "XDG_RUNTIME_DIR"));

      return { xdgConfigHome, xdgStateHome, xdgRuntimeDir };
    }).pipe(
      Effect.mapError((cause) =>
        BootConfigError.make({
          message: "Invalid server boot environment configuration.",
          cause,
        }),
      ),
    ),
  );
}
