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
    typing: true,
    markdown: true,
    attachments: {
      receive: true,
      send: false,
      download: true,
      kinds: ["image", "audio", "video", "document", "archive", "other"],
    },
    stream: { send: true, reply: true, strategy: "native" },
  },
  reactions: {
    receive: false,
    send: false,
  },
  actions: {
    send: true,
    receive: true,
    ack: true,
    reply: true,
    update: true,
    urlButtons: true,
    maxButtonsPerMessage: 100,
    maxButtonsPerRow: 8,
  },
} as const satisfies ChatAdapterCapabilities;
