import { Context, Effect, Scope } from "effect";
import type { ServerControlEndpoint } from "../contracts/control";
import type { ControlServerError } from "../errors";

/** Host transport that binds the local control API as a scoped resource. */
export class ControlTransport extends Context.Service<
  ControlTransport,
  {
    readonly bind: Effect.Effect<void, ControlServerError, Scope.Scope>;
  }
>()("@xmux/server/ControlTransport") {}

/** Internal startup probe used only for duplicate-server liveness checks. */
export class ServerProbe extends Context.Service<
  ServerProbe,
  {
    readonly isAlive: (endpoint: ServerControlEndpoint) => Effect.Effect<boolean>;
  }
>()("@xmux/server/ServerProbe") {}
