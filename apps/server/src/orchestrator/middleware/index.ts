import type { EffectiveServerConfig } from "../../config/effective";
import { createAccessControlMiddleware } from "./access-control";
import { createTypingIndicatorMiddleware } from "./typing-indicator";
import type { ServerXmuxMiddleware } from "./types";

export type { ServerXmuxMiddleware } from "./types";
export { accessForChat, createAccessControlMiddleware } from "./access-control";
export { createTypingIndicatorMiddleware } from "./typing-indicator";

export const makeServerOrchestratorMiddleware = (
  config: EffectiveServerConfig,
): readonly ServerXmuxMiddleware[] => [
  createAccessControlMiddleware(config.chats),
  createTypingIndicatorMiddleware(),
];
