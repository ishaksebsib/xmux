import { Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { serverApi } from "./api";
import { fallback } from "./fallback";
import { handlers } from "./registry";

/** Build the canonical API routes once from the contract and group handlers. */
export const apiRoutes = HttpApiBuilder.layer(serverApi, { openapiPath: "/openapi.json" }).pipe(
  Layer.provide(handlers),
);

/** Stable JSON fallback for unknown paths and unsupported methods. */
export const fallbackRoutes = HttpRouter.addAll([HttpRouter.route("*", "*", fallback)]);

/** One app composition layer; platform binding happens in ../http. */
export const app = Layer.mergeAll(apiRoutes, fallbackRoutes);
