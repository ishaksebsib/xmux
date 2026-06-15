import { defineChatCommand, defineChatCommands, stringOption } from "@xmux/chat-core";

/** Built-in commands registered with every chat adapter. */
export const commands = defineChatCommands({
  new: defineChatCommand({
    description: "Create a new harness session",
    options: {
      harnessId: stringOption({
        description: "Harness adapter id to start, for example opencode or pi",
      }),
      title: stringOption({ description: "Optional session title" }),
    },
  }),
  pwd: defineChatCommand({
    description: "Show the current workspace directory for this chat thread",
  }),
  cd: defineChatCommand({
    description: "Change the current workspace directory for this chat thread",
    options: {
      path: stringOption({
        description: "Directory path to switch to",
        required: true,
      }),
    },
  }),
  ls: defineChatCommand({
    description: "List files in the current workspace directory",
    options: {
      path: stringOption({ description: "Optional directory path to list" }),
    },
  }),
  resume: defineChatCommand({
    description: "List or resume existing harness sessions",
    options: {
      harnessId: stringOption({ description: "Harness adapter id from /resume" }),
      shortId: stringOption({ description: "Short session id shown by /resume" }),
    },
  }),
  delete: defineChatCommand({
    description: "Delete the active or selected harness session",
    options: {
      harnessId: stringOption({ description: "Harness adapter id from /delete" }),
      shortId: stringOption({ description: "Short session id shown by /delete" }),
    },
  }),
  exit: defineChatCommand({
    description: "Exit the active session without deleting it",
  }),
  cancel: defineChatCommand({
    description: "Cancel the active harness generation for this chat thread",
  }),
  allow: defineChatCommand({
    description: "Allow the current harness permission request",
    options: {
      mode: stringOption({
        description: "Use 'always' to allow matching future requests",
        choices: ["always"] as const,
      }),
    },
  }),
  reject: defineChatCommand({
    description: "Reject the current harness permission or question request",
  }),
  model: defineChatCommand({
    description: "Show or set the model for the active session",
    options: {
      selector: stringOption({ description: "Model selector, for example openai/gpt-4.1" }),
    },
  }),
  thinking: defineChatCommand({
    description: "Show or set the thinking level for the active session",
    options: {
      level: stringOption({
        description: "Thinking level: off, minimal, low, medium, high, xhigh, max, or clear",
      }),
    },
  }),
});

export type Commands = typeof commands;

export const commandNames = Object.freeze(Object.keys(commands).map((name) => `/${name}`));
