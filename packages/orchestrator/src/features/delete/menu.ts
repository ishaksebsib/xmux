import type { ChatAdapterDefinitions, Unsubscribe } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Context } from "../../ctx";
import {
  defineMenuCommandItem,
  defineMenuItemId,
  isMenuSessionIdle,
  registerMenuItem,
} from "../menu";
import type { MenuCommandInvocation } from "../menu";

const deleteMenuItemId = defineMenuItemId({ feature: "delete", local: "active" });

const deleteMenuItem = defineMenuCommandItem({
  id: deleteMenuItemId,
  label: "Delete session",
  order: 210,
  style: "danger",
  visible: isMenuSessionIdle,
  command: () =>
    ({
      name: "delete",
      options: { harnessId: undefined, shortId: undefined },
    }) satisfies MenuCommandInvocation,
});

export function registerDeleteMenu<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(ctx: Context<TAdapters, TChats>): Unsubscribe {
  return registerMenuItem(ctx, deleteMenuItem);
}
