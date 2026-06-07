import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Result as BetterResult } from "better-result";
import type { HandlerContext } from "../../../ctx";
import { CommandResponseError } from "../../errors";
import { replyWithResult, threadFromChatEvent, type CommandEvent } from "../../utils";
import { formatPwdFailure, formatPwdSuccess } from "./response";
import { getPwdForThread } from "./service";

export interface HandlePwdCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: CommandEvent<Extract<keyof TChats, string>, "pwd">;
}

export async function handlePwdCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandlePwdCommandInput<TAdapters, TChats>,
): Promise<BetterResult<void, CommandResponseError>> {
  const pwd = await getPwdForThread({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
  });

  return replyWithResult({
    event: input.event,
    command: "pwd",
    result: pwd,
    ok: formatPwdSuccess,
    err: formatPwdFailure,
  });
}
