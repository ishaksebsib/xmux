import { Layer } from "effect";
import { configHandlers } from "./groups/config/handlers";
import { lifecycleHandlers } from "./groups/lifecycle/handlers";
import { logsHandlers } from "./groups/log/handlers";
import { statusHandlers } from "./groups/status/handlers";
import { systemHandlers } from "./groups/system/handlers";

/** One place where route group implementations are registered. */
export const handlers = Layer.mergeAll(
  systemHandlers,
  statusHandlers,
  configHandlers,
  logsHandlers,
  lifecycleHandlers,
);
