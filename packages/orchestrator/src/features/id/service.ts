import type { ChatActor } from "@xmux/chat-core";
import { Result, type Result as ResultType } from "better-result";
import { UserIdUnavailableError } from "./errors";

export interface IdentifyUserInput {
  readonly chatId: string;
  readonly actor?: ChatActor;
}

export interface IdentifyUserOutput {
  readonly chatId: string;
  readonly userId: string;
  readonly displayName?: string;
}

export type IdentifyUserError = UserIdUnavailableError;

/** Returns the normalized chat actor id for the command sender. */
export function identifyUser(
  input: IdentifyUserInput,
): ResultType<IdentifyUserOutput, IdentifyUserError> {
  const userId = nonEmpty(input.actor?.actorId);
  if (userId === undefined) {
    return Result.err(new UserIdUnavailableError({ chatId: input.chatId }));
  }

  return Result.ok({
    chatId: input.chatId,
    userId,
    ...(input.actor?.displayName === undefined ? {} : { displayName: input.actor.displayName }),
  });
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}
