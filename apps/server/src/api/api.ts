import { HttpApi, OpenApi } from "effect/unstable/httpapi";
import { configApi } from "./groups/config/api";
import { lifecycleApi } from "./groups/lifecycle/api";
import { logsApi } from "./groups/log/api";
import { statusApi } from "./groups/status/api";
import { systemApi } from "./groups/system/api";
import { SERVER_PACKAGE_VERSION } from "../package-info";

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
      version: SERVER_PACKAGE_VERSION,
      description: "Local-only control API for the xmux runtime server.",
    }),
  );
