import { Layer } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { serverApi } from "./api";
import { handlerLayer } from "./registry";

/** Canonical control API layer; platform transports decide where it is served. */
export const appLayer = HttpApiBuilder.layer(serverApi, {
  openapiPath: "/openapi.json",
}).pipe(Layer.provide(handlerLayer));
