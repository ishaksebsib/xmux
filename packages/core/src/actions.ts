import { actionValue, defineChatAction, defineChatActions } from "@xmux/chat-core";

export const thinkingActionId = "thinking" as const;

/** Built-in button actions registered with every chat adapter. */
export const actions = defineChatActions({
  [thinkingActionId]: defineChatAction({
    values: {
      off: actionValue(),
      minimal: actionValue(),
      low: actionValue(),
      medium: actionValue(),
      high: actionValue(),
      xhigh: actionValue(),
      max: actionValue(),
    },
  }),
});

export type Actions = typeof actions;
