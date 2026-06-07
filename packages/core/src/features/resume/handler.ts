import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Result } from "better-result";
import type { HandlerContext } from "../../ctx";
import { CommandResponseError } from "../errors";
import { replyWithResult, threadFromChatEvent, type CommandEvent } from "../utils";
import { formatResumeFailure, formatResumeOutput } from "./response";
import { resumeSessionCommand } from "./service";

export interface HandleResumeCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: CommandEvent<
    Extract<keyof TChats, string>,
    "resume",
    { readonly harnessId?: string; readonly shortId?: string }
  >;
}

export async function handleResumeCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: HandleResumeCommandInput<TAdapters, TChats>): Promise<Result<void, CommandResponseError>> {
  const resumed = await resumeSessionCommand({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    harnessId: input.event.command.options.harnessId,
    shortId: input.event.command.options.shortId,
  });

  return replyWithResult({
    event: input.event,
    command: "resume",
    result: resumed,
    ok: formatResumeOutput,
    err: formatResumeFailure,
  });
}
