import { Schema } from "effect";

/** Runtime states are intentionally coarse so client status handling stays stable. */
export const ServerStatusState = Schema.Literals([
  "starting",
  "ready",
  "degraded",
  "reloading",
  "stopping",
  "failed",
]);
export type ServerStatusState = typeof ServerStatusState.Type;
