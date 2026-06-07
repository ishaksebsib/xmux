import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Result as BetterResult } from "better-result";
import type { HandlerContext } from "../../ctx";
import { CommandResponseError } from "../errors";
import { replyWithResult, threadFromChatEvent, type CommandEvent } from "../utils";
import { formatExitFailure, formatExitOutput } from "./response";
import { exitActiveSessionForThread } from "./service";

export interface HandleExitCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: CommandEvent<Extract<keyof TChats, string>, "exit">;
}

export async function handleExitCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleExitCommandInput<TAdapters, TChats>,
): Promise<BetterResult<void, CommandResponseError>> {
  const exited = await exitActiveSessionForThread({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
  });

  return replyWithResult({
    event: input.event,
    command: "exit",
    result: exited,
    ok: formatExitOutput,
    err: formatExitFailure,
  });
}
