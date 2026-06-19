import { Schema } from "effect";

/** Shutdown responses are idempotent so repeated CLI calls are harmless. */
export class ShutdownResponse extends Schema.Class<ShutdownResponse>("ShutdownResponse")({
  accepted: Schema.Boolean,
  alreadyStopping: Schema.Boolean,
}) {}

export const ShutdownAccepted = ShutdownResponse.annotate({ httpApiStatus: 202 });
