import type { DiscordSentMessage } from "../client";

export interface DiscordStreamOutput {
  readonly messages: readonly DiscordSentMessage[];
  readonly lastMessage: DiscordSentMessage;
  reconcile(segments: readonly string[]): Promise<DiscordSentMessage>;
}

export function createDiscordStreamOutput(args: {
  readonly initialMessage: DiscordSentMessage;
  readonly initialContent: string;
  editSegment(args: {
    readonly message: DiscordSentMessage;
    readonly content: string;
    readonly index: number;
  }): Promise<DiscordSentMessage>;
  sendSegment(args: {
    readonly content: string;
    readonly index: number;
  }): Promise<DiscordSentMessage>;
  deleteSegment(args: {
    readonly message: DiscordSentMessage;
    readonly index: number;
  }): Promise<void>;
}): DiscordStreamOutput {
  const messages = [args.initialMessage];
  const contents = [args.initialContent];

  const desiredSegments = (segments: readonly string[]) =>
    segments.length === 0 ? [args.initialContent] : segments;

  return {
    get messages() {
      return [...messages];
    },

    get lastMessage() {
      return messages[messages.length - 1] ?? args.initialMessage;
    },

    async reconcile(segments) {
      const desired = desiredSegments(segments);

      for (const [index, content] of desired.entries()) {
        const existing = messages[index];
        if (existing === undefined) {
          messages.push(await args.sendSegment({ content, index }));
          contents.push(content);
          continue;
        }

        if (contents[index] === content) continue;

        messages[index] = await args.editSegment({ message: existing, content, index });
        contents[index] = content;
      }

      while (messages.length > desired.length) {
        const index = messages.length - 1;
        const [message] = messages.splice(index, 1);
        contents.splice(index, 1);
        if (message !== undefined) {
          await args.deleteSegment({ message, index });
        }
      }

      return this.lastMessage;
    },
  };
}
