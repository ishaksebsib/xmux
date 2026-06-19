import { OpenApi } from "effect/unstable/httpapi";
import { serverApi } from "./api";

/** Build the OpenAPI document from the canonical server API contract. */
export const openApi = () => OpenApi.fromApi(serverApi);

/** JSON string used by package scripts and SDK generation pipelines. */
export const openApiJson = (space: number = 2): string => `${JSON.stringify(openApi(), null, space)}\n`;
