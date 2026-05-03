export { createBus, type ChannelHandle, type XmuxBus, type XmuxEventMap } from "./bus";
export {
  AdapterRegistry,
  type AdapterType,
  type ChatAdapter,
  type HarnessAdapter,
  type XmuxAdapter,
} from "./adapter-registry";
export { OpenCodeHarnessAdapter } from "./adapters/opencode";
export { TelegramMediaAdapter } from "./adapters/telegram";
export { Router } from "./router";

export function fn() {
  return "Hello, tsdown!";
}
