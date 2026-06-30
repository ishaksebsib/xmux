import type { CliOutputCapabilities } from "./capabilities";
import {
  displayWidth,
  padRight,
  statusText,
  styleToken,
  type UiSeverity,
  type UiToken,
} from "./theme";

export interface UiCell {
  readonly text: string;
  readonly token?: UiToken;
}

export interface UiRow {
  readonly cells: ReadonlyArray<UiCell>;
}

export interface UiSection {
  readonly title: string;
  readonly rows: ReadonlyArray<UiRow>;
  readonly emptyText?: string;
}

const ROW_INDENT = "  ";
const COLUMN_GAP = 3;

export const cell = (text: string, token?: UiToken): UiCell =>
  token === undefined ? { text } : { text, token };

export const row = (...cells: ReadonlyArray<UiCell>): UiRow => ({ cells });

export const statusCell = (
  capabilities: CliOutputCapabilities,
  label: string,
  severity: UiSeverity,
): UiCell => cell(statusText(capabilities, severity, label), severity);

const maxColumnCount = (rows: ReadonlyArray<UiRow>): number =>
  rows.reduce((maximum, current) => Math.max(maximum, current.cells.length), 0);

const columnWidth = (rows: ReadonlyArray<UiRow>, index: number): number =>
  rows.reduce((maximum, current) => {
    const currentCell = current.cells[index];
    return currentCell === undefined ? maximum : Math.max(maximum, displayWidth(currentCell.text));
  }, 0);

const columnWidths = (rows: ReadonlyArray<UiRow>): ReadonlyArray<number> =>
  Array.from({ length: maxColumnCount(rows) }, (_unused, index) => columnWidth(rows, index));

const renderCell = (capabilities: CliOutputCapabilities, current: UiCell): string =>
  styleToken(capabilities, current.token, current.text);

const renderRow = (
  capabilities: CliOutputCapabilities,
  widths: ReadonlyArray<number>,
  current: UiRow,
): string => {
  const lastIndex = current.cells.length - 1;
  const rendered = current.cells.map((currentCell, index) => {
    const renderedCell = renderCell(capabilities, currentCell);
    if (index === lastIndex) return renderedCell;

    const width = widths[index] ?? displayWidth(currentCell.text);
    return `${padRight(renderedCell, width)}${" ".repeat(COLUMN_GAP)}`;
  });

  return `${ROW_INDENT}${rendered.join("")}`;
};

const renderSection = (capabilities: CliOutputCapabilities, section: UiSection): string => {
  const title = styleToken(capabilities, "title", section.title);
  if (section.rows.length === 0) {
    const emptyText = section.emptyText ?? "(none)";
    return [title, `${ROW_INDENT}${styleToken(capabilities, "muted", emptyText)}`].join("\n");
  }

  const widths = columnWidths(section.rows);
  return [title, ...section.rows.map((current) => renderRow(capabilities, widths, current))].join(
    "\n",
  );
};

export const renderSections = (
  capabilities: CliOutputCapabilities,
  sections: ReadonlyArray<UiSection>,
): string => sections.map((section) => renderSection(capabilities, section)).join("\n\n");
