import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { Result } from "better-result";
import type { HandlerContext } from "../../ctx";
import { CommandResponseError } from "../errors";
import { replyWithResult, threadFromChatEvent, type CommandEvent } from "../utils";
import {
  respondToCurrentInteractionForThread,
  type InteractionCommandAction,
  type RespondToCurrentInteractionOutput,
} from "./service";
import { formatInteractionFailure, formatInteractionOutput } from "./response";

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
