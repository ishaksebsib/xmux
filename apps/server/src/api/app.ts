import { Layer } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { serverApi } from "./api";
import { handlers } from "./registry";

/** Build the canonical API routes once from the contract and group handlers. */
export const apiRoutes = HttpApiBuilder.layer(serverApi, { openapiPath: "/openapi.json" }).pipe(
  Layer.provide(handlers),
);

/** One app composition layer; platform binding happens in ../http. */
export const app = apiRoutes;
