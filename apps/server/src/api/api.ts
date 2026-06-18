import { HttpApi } from "effect/unstable/httpapi";
import { ConfigApi } from "./groups/config";
import { LifecycleApi } from "./groups/lifecycle";
import { LogsApi } from "./groups/logs";
import { StatusApi } from "./groups/status";
import { SystemApi } from "./groups/system";

/** Canonical local server API contract. Add future route groups here. */
export const XmuxServerApi = HttpApi.make("xmux-server")
  .add(SystemApi)
  .add(StatusApi)
  .add(ConfigApi)
  .add(LogsApi)
  .add(LifecycleApi);
