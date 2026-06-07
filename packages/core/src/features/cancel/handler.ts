import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Result as BetterResult } from "better-result";
import type { HandlerContext } from "../../ctx";
import { CommandResponseError } from "../errors";
import { replyWithResult, threadFromChatEvent, type CommandEvent } from "../utils";
import { formatCancelFailure, formatCancelOutput } from "./response";
import { cancelActivePromptForThread } from "./service";

export interface HandleCancelCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: CommandEvent<Extract<keyof TChats, string>, "cancel">;
}

/** Handles `/cancel` from any configured chat adapter. */
export async function handleCancelCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleCancelCommandInput<TAdapters, TChats>,
): Promise<BetterResult<void, CommandResponseError>> {
  const cancelled = await cancelActivePromptForThread({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
  });

  return replyWithResult({
    event: input.event,
    command: "cancel",
    result: cancelled,
    ok: formatCancelOutput,
    err: formatCancelFailure,
  });
}
