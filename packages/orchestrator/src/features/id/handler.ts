import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Result } from "better-result";
import type { HandlerContext } from "../../ctx";
import { CommandResponseError } from "../errors";
import { replyWithResult, type CommandEvent } from "../utils";
import { formatIdFailure, formatIdOutput } from "./response";
import { identifyUser } from "./service";

export interface HandleIdCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: CommandEvent<Extract<keyof TChats, string>, "id">;
}

/** Handles `/id` from any configured chat adapter. */
export async function handleIdCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: HandleIdCommandInput<TAdapters, TChats>): Promise<Result<void, CommandResponseError>> {
  const identified = identifyUser({
    chatId: input.event.chatId,
    actor: input.event.actor,
  });

  return replyWithResult({
    event: input.event,
    command: "id",
    result: identified,
    ok: formatIdOutput,
    err: formatIdFailure,
  });
}
