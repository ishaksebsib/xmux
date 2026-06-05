import { actionValue, defineChatAction, defineChatActions } from "@xmux/chat-core";

export const thinkingActionId = "thinking" as const;
export const modelActionId = "model" as const;

function actionWithoutPayload() {
  return actionValue<undefined>();
}

/** Built-in button actions registered with every chat adapter. */
export const actions = defineChatActions({
  [modelActionId]: defineChatAction({
    values: {
      available: actionWithoutPayload(),
    },
  }),
  [thinkingActionId]: defineChatAction({
    values: {
      off: actionWithoutPayload(),
      minimal: actionWithoutPayload(),
      low: actionWithoutPayload(),
      medium: actionWithoutPayload(),
      high: actionWithoutPayload(),
      xhigh: actionWithoutPayload(),
      max: actionWithoutPayload(),
    },
  }),
});

export type Actions = typeof actions;
