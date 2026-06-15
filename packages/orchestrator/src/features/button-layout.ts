import type { ChatButtonInput } from "@xmux/chat-core";
import type { Actions } from "../actions";

const maxActionRows = 5;
const maxButtonsPerRow = 5;
const maxButtonsTotal = maxActionRows * maxButtonsPerRow;

export function formatActionButtonRows(
  buttons: readonly ChatButtonInput<Actions>[],
  buttonsPerRow = maxButtonsPerRow,
): readonly (readonly ChatButtonInput<Actions>[])[] {
  const size = Math.min(Math.max(1, buttonsPerRow), maxButtonsPerRow);
  const rows: ChatButtonInput<Actions>[][] = [];
  const displayed = buttons.slice(0, maxButtonsTotal);

  if (displayed.length <= maxActionRows) {
    return displayed.map((button) => [button]);
  }

  for (let index = 0; index < displayed.length; index += size) {
    rows.push(displayed.slice(index, index + size));
  }

  return rows.slice(0, maxActionRows);
}
