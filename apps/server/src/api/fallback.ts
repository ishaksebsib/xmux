import { Effect } from "effect";
import { HttpServerRequest } from "effect/unstable/http";
import { jsonError } from "./shared/errors";

const parsePathname = (url: string): string => {
  try {
    return new URL(url, "http://xmux.local").pathname;
  } catch {
    return "/";
  }
};

// TODO: replace this with something dynamic
const routePaths = new Set([
  "/healthz",
  "/v1/status",
  "/v1/config/effective",
  "/v1/config/validate",
  "/v1/logs",
  "/v1/shutdown",
  "/openapi.json",
]);

export const fallback = Effect.fn("api.fallback")(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const pathname = parsePathname(request.url);
  const method = request.method.toUpperCase();

  if (routePaths.has(pathname)) {
    return yield* jsonError({
      status: 405,
      code: "method_not_allowed",
      message: `Unsupported method: ${method}`,
    }).pipe(Effect.orDie);
  }

  return yield* jsonError({
    status: 404,
    code: "not_found",
    message: `Unknown route: ${pathname}`,
  }).pipe(Effect.orDie);
});
