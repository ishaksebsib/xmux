import { Layer } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { serverApi } from "./api";
import { handlers } from "./registry";

/** Canonical control API layer; platform transports decide where it is served. */
export const app = HttpApiBuilder.layer(serverApi, {
  openapiPath: "/openapi.json",
}).pipe(Layer.provide(handlers));
