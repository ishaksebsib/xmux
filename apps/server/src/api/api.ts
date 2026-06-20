import { HttpApi, HttpApiBuilder, OpenApi } from "effect/unstable/httpapi";
import { API_VERSION } from "../contracts/constants";
import { configApi } from "./groups/config/api";
import { lifecycleApi } from "./groups/lifecycle/api";
import { logsApi } from "./groups/log/api";
import { statusApi } from "./groups/status/api";
import { systemApi } from "./groups/system/api";
import { handlers } from "./registry";
import { Layer } from "effect";

/** Canonical local server API contract. Add future route groups here. */
export const serverApi = HttpApi.make("xmux-server")
  .add(systemApi)
  .add(statusApi)
  .add(configApi)
  .add(logsApi)
  .add(lifecycleApi)
  .annotateMerge(
    OpenApi.annotations({
      title: "xmux local server API",
      version: `${API_VERSION}`,
      description: "Local-only control API for the xmux runtime server.",
    }),
  );

/** Canonical control API layer; platform transports decide where it is served. */
export const app = HttpApiBuilder.layer(serverApi, {
  openapiPath: "/openapi.json",
}).pipe(Layer.provide(handlers));
