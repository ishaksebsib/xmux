import type { SlackActionEvent, SlackCommandEvent } from "../client";
import { recordAt, stringAt } from "../utils";

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

export interface SlackActionInteractionContext {
  readonly interactionId: string;
  readonly responseUrl?: string;
  readonly channelId: string;
  readonly userId: string;
  readonly messageTs: string;
  readonly threadTs?: string;
  readonly teamId?: string;
  readonly enterpriseId?: string;
  readonly triggerId?: string;
  readonly actionTs?: string;
  readonly createdAt: number;
  readonly raw: SlackActionEvent["body"];
}

export interface SlackInteractionRegistry {
  putCommand(context: SlackCommandInteractionContext): void;
  getCommand(interactionId: string): SlackCommandInteractionContext | undefined;
  putAction(context: SlackActionInteractionContext): void;
  getAction(interactionId: string): SlackActionInteractionContext | undefined;
  delete(interactionId: string): void;
  sweep(now?: number): void;
}

export function createSlackInteractionRegistry(
  args: { readonly ttlMs?: number } = {},
): SlackInteractionRegistry {
  const ttlMs = args.ttlMs ?? defaultInteractionTtlMs;
  const commandContexts = new Map<string, SlackCommandInteractionContext>();
  const actionContexts = new Map<string, SlackActionInteractionContext>();

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
    putAction(context) {
      actionContexts.set(context.interactionId, context);
      this.sweep();
    },
    getAction(interactionId) {
      const context = actionContexts.get(interactionId);
      if (context === undefined) {
        return undefined;
      }

      if (Date.now() - context.createdAt > ttlMs) {
        actionContexts.delete(interactionId);
        return undefined;
      }

      return context;
    },
    delete(interactionId) {
      commandContexts.delete(interactionId);
      actionContexts.delete(interactionId);
    },
    sweep(now = Date.now()) {
      for (const [interactionId, context] of commandContexts) {
        if (now - context.createdAt > ttlMs) {
          commandContexts.delete(interactionId);
        }
      }
      for (const [interactionId, context] of actionContexts) {
        if (now - context.createdAt > ttlMs) {
          actionContexts.delete(interactionId);
        }
      }
    },
  };
}

export function createSlackCommandInteractionId(payload: SlackCommandEvent["payload"]): string {
  return `slack-command:${payload.trigger_id}`;
}

export function createSlackActionInteractionId(event: SlackActionEvent): string {
  const triggerId = stringAt(event.body, "trigger_id");
  if (triggerId !== undefined) {
    return `slack-action:${triggerId}`;
  }

  const channelId = stringAt(recordAt(event.body, "channel"), "id") ?? "unknown-channel";
  const messageTs = stringAt(recordAt(event.body, "message"), "ts") ?? "unknown-message";
  const actionTs = stringAt(event.action, "action_ts") ?? String(Date.now());
  return `slack-action:${channelId}:${messageTs}:${actionTs}`;
}
