import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Result } from "better-result";
import type { HandlerContext } from "../../ctx";
import { CommandResponseError } from "../errors";
import { replyWithResult, threadFromChatEvent, type CommandEvent } from "../utils";
import { formatDeleteFailure, formatDeleteOutput } from "./response";
import { deleteSessionCommand } from "./service";

export interface HandleDeleteCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: CommandEvent<
    Extract<keyof TChats, string>,
    "delete",
    { readonly harnessId?: string; readonly shortId?: string }
  >;
}

export async function handleDeleteCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: HandleDeleteCommandInput<TAdapters, TChats>): Promise<Result<void, CommandResponseError>> {
  const deleted = await deleteSessionCommand({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    harnessId: input.event.command.options.harnessId,
    shortId: input.event.command.options.shortId,
  });

  return replyWithResult({
    event: input.event,
    command: "delete",
    result: deleted,
    ok: formatDeleteOutput,
    err: formatDeleteFailure,
  });
}
