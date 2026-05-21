import { defineChatCommand, defineChatCommands, stringOption } from "@xmux/chat-core";

/** Built-in commands registered with every chat adapter. */
export const commands = defineChatCommands({
  new: defineChatCommand({
    description: "Create a new harness session",
    options: {
      harnessId: stringOption({
        description: "Harness adapter id to start, for example opencode or pi",
        required: true,
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
});

export type Commands = typeof commands;
