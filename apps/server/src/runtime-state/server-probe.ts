import { Context, Effect } from "effect";
import type { ServerControlEndpoint } from "../options";

/** Internal startup probe used only for duplicate-server liveness checks. */
export class ServerProbe extends Context.Service<
  ServerProbe,
  {
    readonly isAlive: (endpoint: ServerControlEndpoint) => Effect.Effect<boolean>;
  }
>()("@xmux/server/ServerProbe") {}
