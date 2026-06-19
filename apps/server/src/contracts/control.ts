import { Schema } from "effect";
import {
  ServerStatusState as ServerStatusStateSchema,
  type ServerStatusState as ServerStatusStateType,
} from "../runtime/status-state";
import { RESPONSE_VERSION } from "../api/shared/version";
export { HealthResponse } from "../api/groups/system/schemas";
export { ShutdownResponse } from "../api/groups/lifecycle/schemas";
export { StatusResponse } from "../api/groups/status/schemas";
export { ApiErrorPayload as ControlErrorPayload, ApiErrorResponse as ControlErrorResponse } from "../api/shared/errors";

/** Backward-compatible runtime state schema alias for older imports. */
export const ServerStatusState = ServerStatusStateSchema;
export type ServerStatusState = ServerStatusStateType;

/** Backward-compatible response version alias for older imports. */
export const CONTROL_RESPONSE_VERSION = RESPONSE_VERSION;

/** Deprecated compatibility schema alias for type imports expecting this name. */
export const ControlResponseVersion = Schema.Literal(RESPONSE_VERSION);
