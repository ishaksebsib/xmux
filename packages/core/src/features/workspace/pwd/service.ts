import type { ChatAdapterDefinitions } from "@xmux/chat-core";
import type { HarnessAdapterDefinitions } from "@xmux/harness-core";
import type { Result } from "better-result";
import type { HandlerContext } from "../../../ctx";
import type { ChatThreadRef } from "../../../store";
import { getCurrentWorkspaceCwd, type GetCurrentWorkspaceCwdError } from "../utils";

export type GetPwdForThreadError = GetCurrentWorkspaceCwdError;

export interface GetPwdForThreadInput<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
> {
  readonly ctx: HandlerContext<TAdapters, TChats>;
  readonly thread: ChatThreadRef;
}

/** Reads the current workspace directory for a chat thread. */
export function getPwdForThread<
  TAdapters extends HarnessAdapterDefinitions<TAdapters>,
  TChats extends ChatAdapterDefinitions<TChats>,
>(input: GetPwdForThreadInput<TAdapters, TChats>): Promise<Result<string, GetPwdForThreadError>> {
  return getCurrentWorkspaceCwd({ ctx: input.ctx.app, thread: input.thread });
}
