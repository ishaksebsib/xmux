import type { ChatAdapterDefinitions, Unsubscribe } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Context } from "../../../ctx";
import { defineMenuCommandItem, defineMenuItemId, registerMenuItem } from "../../menu";
import type { MenuCommandInvocation } from "../../menu";

const pwdMenuItemId = defineMenuItemId({ feature: "pwd", local: "show" });

const pwdMenuItem = defineMenuCommandItem({
  id: pwdMenuItemId,
  label: "$pwd",
  order: 300,
  style: "secondary",
  visible: () => true,
  command: () =>
    ({
      name: "pwd",
      options: {},
    }) satisfies MenuCommandInvocation,
});

export function registerPwdMenu<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(ctx: Context<TAdapters, TChats>): Unsubscribe {
  return registerMenuItem(ctx, pwdMenuItem);
}
