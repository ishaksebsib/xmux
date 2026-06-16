import type { SlackCommandEvent } from "../client";

const defaultInteractionTtlMs = 29 * 60 * 1_000;

export interface SlackCommandInteractionContext {
  readonly interactionId: string;
  readonly commandId: string;
  readonly commandName: string;
  readonly responseUrl: string;
  readonly channelId: string;
  readonly userId: string;
  readonly triggerId: string;
  readonly createdAt: number;
  readonly raw: SlackCommandEvent["payload"];
}

export interface SlackInteractionRegistry {
  putCommand(context: SlackCommandInteractionContext): void;
  getCommand(interactionId: string): SlackCommandInteractionContext | undefined;
  delete(interactionId: string): void;
  sweep(now?: number): void;
}

export function createSlackInteractionRegistry(
  args: { readonly ttlMs?: number } = {},
): SlackInteractionRegistry {
  const ttlMs = args.ttlMs ?? defaultInteractionTtlMs;
  const commandContexts = new Map<string, SlackCommandInteractionContext>();

  return {
    putCommand(context) {
      commandContexts.set(context.interactionId, context);
      this.sweep();
    },
    getCommand(interactionId) {
      const context = commandContexts.get(interactionId);
      if (context === undefined) {
        return undefined;
      }

      if (Date.now() - context.createdAt > ttlMs) {
        commandContexts.delete(interactionId);
        return undefined;
      }

      return context;
    },
    delete(interactionId) {
      commandContexts.delete(interactionId);
    },
    sweep(now = Date.now()) {
      for (const [interactionId, context] of commandContexts) {
        if (now - context.createdAt > ttlMs) {
          commandContexts.delete(interactionId);
        }
      }
    },
  };
}

export function createSlackCommandInteractionId(payload: SlackCommandEvent["payload"]): string {
  return `slack-command:${payload.trigger_id}`;
}
