import { Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { XmuxServerApi } from "./api";
import { fallbackHandler, XmuxServerHandlers } from "./handlers";

/** Build the canonical API routes once from the contract and group handlers. */
export const XmuxServerApiLive = HttpApiBuilder.layer(XmuxServerApi).pipe(
  Layer.provide(XmuxServerHandlers),
);

/** Stable JSON fallback for unknown paths and unsupported methods. */
export const FallbackRoutesLive = HttpRouter.addAll([
  HttpRouter.route("*", "*", fallbackHandler),
]);

/** One app composition layer; platform binding happens in ../http. */
export const XmuxServerAppLive = Layer.mergeAll(XmuxServerApiLive, FallbackRoutesLive);
