import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Result } from "better-result";
import type { HandlerContext } from "../../../ctx";
import { CommandResponseError } from "../../errors";
import { replyWithResult, threadFromChatEvent, type CommandEvent } from "../../utils";
import { formatCdFailure, formatCdSuccess } from "./response";
import { changeDirectoryForThread } from "./service";

export interface HandleCdCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: CommandEvent<Extract<keyof TChats, string>, "cd", { readonly path: string }>;
}

export async function handleCdCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: HandleCdCommandInput<TAdapters, TChats>): Promise<Result<void, CommandResponseError>> {
  const changed = await changeDirectoryForThread({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    path: input.event.command.options.path,
  });

  return replyWithResult({
    event: input.event,
    command: "cd",
    result: changed,
    ok: formatCdSuccess,
    err: formatCdFailure,
  });
}
