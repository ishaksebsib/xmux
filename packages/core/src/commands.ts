import { defineChatCommand, defineChatCommands, stringOption } from "@xmux/chat-core";

/** Built-in xmux commands registered with every chat adapter. */
export const xmuxCommands = defineChatCommands({
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
});

export type XmuxCommands = typeof xmuxCommands;
