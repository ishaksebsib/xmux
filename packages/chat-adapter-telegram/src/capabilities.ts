import type { ChatAdapterCapabilities } from "@xmux/chat-core";

export const telegramAdapterCapabilities = {
  commands: {
    registration: "dynamic",
    options: false,
    choices: false,
    autocomplete: false,
  },
  messages: {
    send: true,
    reply: true,
    edit: false,
    delete: false,
    typing: false,
    markdown: true,
    attachments: false,
  },
  reactions: {
    receive: false,
    send: false,
  },
} as const satisfies ChatAdapterCapabilities;
