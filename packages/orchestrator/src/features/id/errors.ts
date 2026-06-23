import { TaggedError } from "better-result";

/** Returned when a chat command event does not carry a usable actor id. */
export class UserIdUnavailableError extends TaggedError("UserIdUnavailableError")<{
  readonly chatId: string;
  readonly message: string;
}>() {
  constructor(args: { readonly chatId: string }) {
    super({ ...args, message: `User id unavailable for chat ${args.chatId}` });
  }
}
