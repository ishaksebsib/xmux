import type { ChatActor, ChatConversationRef, ChatTextInput } from "@xmux/chat-core";
import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import { Result, type Result as BetterResult } from "better-result";
import type { HandlerContext } from "../../ctx";
import { replyToChatEvent, threadFromChatEvent } from "../utils";
import { ResumeCommandResponseError } from "./errors";
import { formatResumeFailure, formatResumeOutput } from "./response";
import { resumeSessionCommand } from "./service";

export interface HandleResumeCommandInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly event: ResumeCommandEvent;
}

export interface ResumeCommandEvent<TChatId extends string = string> {
  readonly type: "command";
  readonly chatId: TChatId;
  readonly conversation: ChatConversationRef<TChatId>;
  readonly actor?: ChatActor;
  readonly command: {
    readonly name: "resume";
    readonly options: {
      readonly harnessId?: string;
      readonly shortId?: string;
    };
  };
  readonly reply: (message: ChatTextInput) => Promise<BetterResult<unknown, unknown>>;
}

/** Handles `/resume` and `/resume <harnessId> <shortId>` from any configured chat adapter. */
export async function handleResumeCommand<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(
  input: HandleResumeCommandInput<TAdapters, TChats>,
): Promise<BetterResult<void, ResumeCommandResponseError>> {
  const resumed = await resumeSessionCommand({
    ctx: input.ctx,
    thread: threadFromChatEvent(input.event),
    harnessId: input.event.command.options.harnessId,
    shortId: input.event.command.options.shortId,
  });

  const response = Result.match(resumed, {
    ok: (value) => formatResumeOutput(value),
    err: (error) => formatResumeFailure(error),
  });

  return replyToChatEvent({
    event: input.event,
    message: response,
    onError: (cause) => new ResumeCommandResponseError({ cause }),
  });
}
