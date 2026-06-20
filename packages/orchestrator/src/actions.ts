import { actionValue, defineChatAction, defineChatActions } from "@xmux/chat-core";

export const thinkingActionId = "thinking" as const;
export const modelActionId = "model" as const;
export const newHarnessActionId = "nh" as const;
export const deleteHarnessActionId = "dh" as const;
export const deleteSessionActionId = "d" as const;
export const resumeHarnessActionId = "rh" as const;
export const resumeSessionActionId = "r" as const;
export const interactionActionId = "i" as const;
export const sttActionId = "stt" as const;

function actionWithoutPayload() {
  return actionValue<undefined>();
}

/** Built-in button actions registered with every chat adapter. */
export const actions = defineChatActions({
  [modelActionId]: defineChatAction({
    values: {
      available: actionWithoutPayload(),
      p: actionValue<string>(),
      m: actionValue<string>(),
      t: actionValue<string>(),
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
  [newHarnessActionId]: defineChatAction({
    values: {
      x: actionValue<string>(),
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
  [interactionActionId]: defineChatAction({
    // Payload is the interaction ordinal as a string, kept compact to fit
    // Telegram's 64-byte callback_data budget.
    values: {
      allow: actionValue<string>(),
      always: actionValue<string>(),
      reject: actionValue<string>(),
    },
  }),
  [sttActionId]: defineChatAction({
    values: {
      cancel: actionValue<string>(),
      send: actionValue<string>(),
    },
  }),
});

export type Actions = typeof actions;
