import type { ChatAdapterDefinitions, Unsubscribe } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Context } from "../../ctx";
import { defineMenuCommandItem, defineMenuItemId, registerMenuItem } from "../menu";
import type { MenuCommandInvocation } from "../menu";

const resumeMenuItemId = defineMenuItemId({ feature: "resume", local: "open" });

const resumeMenuItem = defineMenuCommandItem({
  id: resumeMenuItemId,
  label: "Resume session",
  order: 20,
  style: "primary",
  visible: (state) => state.session.status === "inactive" && state.harnessIds.length > 0,
  command: () =>
    ({
      name: "resume",
      options: { harnessId: undefined, shortId: undefined },
    }) satisfies MenuCommandInvocation,
});

export function registerResumeMenu<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(ctx: Context<TAdapters, TChats>): Unsubscribe {
  return registerMenuItem(ctx, resumeMenuItem);
}
