import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Result } from "better-result";
import type { HandlerContext } from "../../../ctx";
import { CommandResponseError } from "../../errors";
import { replyWithResult, threadFromChatEvent, type CommandEvent } from "../../utils";
import { formatLsFailure, formatLsSuccess } from "./response";
import { listDirectoryForThread } from "./service";

export interface HandleLsCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: CommandEvent<Extract<keyof TChats, string>, "ls", { readonly path?: string }>;
}

export async function handleLsCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: HandleLsCommandInput<TAdapters, TChats>): Promise<Result<void, CommandResponseError>> {
  const listed = await listDirectoryForThread({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    path: input.event.command.options.path,
  });

  return replyWithResult({
    event: input.event,
    command: "ls",
    result: listed,
    ok: formatLsSuccess,
    err: formatLsFailure,
  });
}
