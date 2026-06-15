import type { ChatTextInput } from "@xmux/chat-core";
import { formatCommandHelp, inlineCode, markdown, markdownText } from "../../../components";
import type { GetPwdForThreadError } from "./service";

export function formatPwdSuccess(cwd: string): ChatTextInput {
  return markdown({
    text: ["**Current directory** :", "", inlineCode(cwd)].join("\n"),
  });
}

export function formatPwdFailure(error: GetPwdForThreadError): ChatTextInput {
  return markdown({
    text: ["**Error:** Failed to read current directory", "", markdownText(error.message)].join(
      "\n",
    ),
  });
}

export function formatPwdCommandUsage(): ChatTextInput {
  return formatCommandHelp({
    command: "/pwd",
    summary: "show current directory",
    description: "Display the workspace directory for this chat thread.",
    usage: "/pwd",
    examples: ["/pwd"],
  });
}
