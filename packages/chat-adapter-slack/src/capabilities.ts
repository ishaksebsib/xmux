import type { ChatAdapterCapabilities } from "@xmux/chat-core";

export const slackAdapterCapabilities = {
  commands: {
    registration: "manual",
    options: true,
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
    attachments: {
      receive: true,
      send: false,
      download: true,
      kinds: ["image", "audio", "video", "document", "archive", "other"],
    },
    stream: { send: true, reply: true, strategy: "edit" },
  },
  reactions: {
    receive: true,
    send: false,
  },
  actions: {
    send: true,
    receive: true,
    ack: true,
    reply: true,
    update: true,
    urlButtons: true,
    maxButtonsPerMessage: 25,
    maxButtonsPerRow: 5,
  },
} as const satisfies ChatAdapterCapabilities;
