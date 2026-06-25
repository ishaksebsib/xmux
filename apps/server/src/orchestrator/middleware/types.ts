import type { ChatAdapterDefinition, ChatAdapterObject } from "@xmux/chat-core";
import type { HarnessAdapterDefinition, HarnessAdapterObject } from "@xmux/harness-core";
import type { XmuxMiddleware } from "@xmux/orchestrator";

export type ServerChatAdapters = Record<
  string,
  ChatAdapterDefinition<string, ChatAdapterObject, ChatAdapterObject>
>;

export type ServerHarnessAdapters = Record<
  string,
  HarnessAdapterDefinition<string, HarnessAdapterObject, HarnessAdapterObject, HarnessAdapterObject>
>;

export type ServerXmuxMiddleware = XmuxMiddleware<ServerHarnessAdapters, ServerChatAdapters>;
