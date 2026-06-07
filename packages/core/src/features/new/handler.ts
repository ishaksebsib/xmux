import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Result } from "better-result";
import type { HandlerContext } from "../../ctx";
import { CommandResponseError } from "../errors";
import { replyWithResult, threadFromChatEvent, type CommandEvent } from "../utils";
import { createSessionForThread } from "./service";
import { formatNewSessionFailure, formatNewSessionSuccess } from "./response";

export interface HandleNewCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: CommandEvent<
    Extract<keyof TChats, string>,
    "new",
    { readonly harnessId: string; readonly title?: string }
  >;
}

export async function handleNewCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: HandleNewCommandInput<TAdapters, TChats>): Promise<Result<void, CommandResponseError>> {
  const created = await createSessionForThread({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    harnessId: input.event.command.options.harnessId,
    title: input.event.command.options.title,
  });

  return replyWithResult({
    event: input.event,
    command: "new",
    result: created,
    ok: formatNewSessionSuccess,
    err: formatNewSessionFailure,
  });
}
