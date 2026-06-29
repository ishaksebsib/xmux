import type { ChatAdapterDefinitions, Unsubscribe } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Context } from "../../ctx";
import { xmuxLogEvents } from "../../logger";
import { serializeXmuxLogError } from "../../logger-utils";
import type { MenuCommandItem } from "./item";

export function registerMenuItem<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(ctx: Context<TAdapters, TChats>, item: MenuCommandItem): Unsubscribe {
  const registered = ctx.services.menu.register(item);

  if (registered.isOk()) {
    return registered.value;
  }

  ctx.logger.error(xmuxLogEvents.operationFailure, {
    operation: "menu",
    result: "error",
    reason: "menu_item_registration_failed",
    menuItemId: item.id,
    error: serializeXmuxLogError(registered.error),
  });

  return () => {};
}
