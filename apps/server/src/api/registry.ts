import { Layer } from "effect";
import { configHandlerLayer } from "./groups/config/handlers";
import { lifecycleHandlerLayer } from "./groups/lifecycle/handlers";
import { logsHandlerLayer } from "./groups/log/handlers";
import { statusHandlerLayer } from "./groups/status/handlers";
import { systemHandlerLayer } from "./groups/system/handlers";

/** One place where route group implementations are registered. */
export const handlerLayer = Layer.mergeAll(
  systemHandlerLayer,
  statusHandlerLayer,
  configHandlerLayer,
  logsHandlerLayer,
  lifecycleHandlerLayer,
);
