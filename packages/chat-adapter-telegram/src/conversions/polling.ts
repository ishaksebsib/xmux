import type { PollingOptions } from "grammy";
import type { TelegramAdapterMode } from "../types";

export function encodeTelegramPollingOptions(
  mode: Extract<TelegramAdapterMode, { readonly type: "polling" }>,
): PollingOptions {
  return {
    ...(mode.dropPendingUpdates === undefined
      ? {}
      : { drop_pending_updates: mode.dropPendingUpdates }),
    ...(mode.allowedUpdates === undefined ? {} : { allowed_updates: mode.allowedUpdates }),
  };
}
