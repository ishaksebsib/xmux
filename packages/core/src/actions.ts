import { actionValue, defineChatAction, defineChatActions } from "@xmux/chat-core";

export const thinkingActionId = "thinking" as const;
export const modelActionId = "model" as const;
export const deleteHarnessActionId = "dh" as const;
export const deleteSessionActionId = "d" as const;
export const resumeHarnessActionId = "rh" as const;
export const resumeSessionActionId = "r" as const;

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
  [deleteHarnessActionId]: defineChatAction({
    values: {
      x: actionValue<string>(),
    },
  }),
  [deleteSessionActionId]: defineChatAction({
    values: {
      x: actionValue<string>(),
    },
  }),
  [resumeHarnessActionId]: defineChatAction({
    values: {
      x: actionValue<string>(),
    },
  }),
  [resumeSessionActionId]: defineChatAction({
    values: {
      x: actionValue<string>(),
    },
  }),
});

export type Actions = typeof actions;
