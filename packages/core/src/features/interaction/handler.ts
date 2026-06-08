import type { ChatActionEvent, ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { Result } from "better-result";
import { interactionActionId, type Actions } from "../../actions";
import type { HandlerContext } from "../../ctx";
import { CommandResponseError } from "../errors";
import { replyWithResult, respondToAction, threadFromChatEvent, type CommandEvent } from "../utils";
import {
  respondToCurrentInteractionForThread,
  type InteractionCommandAction,
  type InteractionTarget,
  type RespondToCurrentInteractionOutput,
} from "./service";
import {
  formatInteractionFailure,
  formatInteractionOutput,
  formatInteractionResolvedMessage,
  formatInteractionStaleMessage,
} from "./response";

export interface HandleInteractionCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: CommandEvent<Extract<keyof TChats, string>, string>;
  readonly action: InteractionCommandAction;
}

function isSilentAllowResponse(output: RespondToCurrentInteractionOutput): boolean {
  return (
    output.status === "responded" &&
    (output.action === "allowed_once" || output.action === "allowed_always")
  );
}

export async function handleInteractionCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleInteractionCommandInput<TAdapters, TChats>,
): Promise<Result<void, CommandResponseError>> {
  const responded = await respondToCurrentInteractionForThread({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    action: input.action,
  });

  if (responded.isOk() && isSilentAllowResponse(responded.value)) {
    return Result.ok();
  }

  return replyWithResult({
    event: input.event,
    command: input.event.command.name,
    result: responded,
    ok: formatInteractionOutput,
    err: formatInteractionFailure,
  });
}

export interface HandleInteractionActionInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: ChatActionEvent<
    Actions,
    typeof interactionActionId,
    Extract<keyof TChats, string>,
    Result<unknown, unknown>
  >;
}

export async function handleInteractionAction<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleInteractionActionInput<TAdapters, TChats>,
): Promise<Result<void, CommandResponseError>> {
  const command = input.event.value === "reject" ? "reject" : "allow";

  const acknowledged = await respondToAction({ command, respond: () => input.event.ack() });
  if (acknowledged.isErr()) return acknowledged;

  const responded = await respondToCurrentInteractionForThread({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    action: toInteractionAction(input.event.value),
    target: toInteractionTarget(input.event.payload),
  });

  if (responded.isErr()) {
    return respondToAction({
      command,
      respond: () => input.event.reply(formatInteractionFailure(responded.error)),
    });
  }

  const message =
    responded.value.status === "responded"
      ? formatInteractionResolvedMessage({
          kind: responded.value.interaction.kind,
          action: responded.value.action,
        })
      : formatInteractionStaleMessage();

  return respondToAction({
    command,
    respond: () =>
      input.event.update({
        message: { text: message.text, format: message.format },
        buttons: message.buttons,
      }),
  });
}

function toInteractionAction(value: "allow" | "always" | "reject"): InteractionCommandAction {
  switch (value) {
    case "allow":
      return { type: "allow", always: false };
    case "always":
      return { type: "allow", always: true };
    case "reject":
      return { type: "reject" };
  }
}

function toInteractionTarget(payload: string | undefined): InteractionTarget {
  const ordinal = Number(payload);
  return Number.isInteger(ordinal) && ordinal > 0
    ? { type: "ordinal", ordinal }
    : { type: "current" };
}
