import { Result } from "better-result";
import type { Code, Content, Heading, Link, List, ListItem, Parent, Root, Table } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import type { MessageEntity } from "grammy/types";

export interface TelegramRenderedText {
  readonly text: string;
  readonly entities: readonly MessageEntity[];
}

export interface RenderTelegramMarkdownOptions {
  readonly heal?: boolean;
}

type MutableEntity = MessageEntity;

interface RenderState {
  text: string;
  readonly entities: MutableEntity[];
}

export function renderTelegramMarkdownPreview(markdown: string): TelegramRenderedText {
  return renderTelegramMarkdown(markdown, { heal: true });
}

export function renderTelegramMarkdownFinal(markdown: string): TelegramRenderedText {
  return renderTelegramMarkdown(markdown, { heal: false });
}

export function validateTelegramEntities(rendered: TelegramRenderedText): Result<void, Error> {
  const sorted = sortTelegramEntities(rendered.entities);

  for (const entity of sorted) {
    if (entity.length <= 0) {
      return Result.err(new Error(`Telegram entity has non-positive length: ${entity.type}`));
    }

    if (entity.offset < 0 || entity.offset + entity.length > rendered.text.length) {
      return Result.err(new Error(`Telegram entity is out of bounds: ${entity.type}`));
    }
  }

  for (let index = 0; index < sorted.length; index += 1) {
    const left = sorted[index];
    if (left === undefined) {
      continue;
    }

    for (let nextIndex = index + 1; nextIndex < sorted.length; nextIndex += 1) {
      const right = sorted[nextIndex];
      if (right === undefined) {
        continue;
      }

      const leftEnd = left.offset + left.length;
      const rightEnd = right.offset + right.length;
      if (right.offset >= leftEnd) {
        break;
      }

      const nested = right.offset >= left.offset && rightEnd <= leftEnd;
      const overlapping = right.offset < leftEnd && rightEnd > leftEnd;
      if (overlapping && !nested) {
        return Result.err(
          new Error(`Telegram entities partially overlap: ${left.type}/${right.type}`),
        );
      }

      if ((left.type === "code" || left.type === "pre") && nested) {
        return Result.err(new Error(`Telegram ${left.type} entity cannot contain nested entities`));
      }
    }
  }

  return Result.ok();
}

function normalizeTelegramEntities(entities: readonly MessageEntity[]): readonly MessageEntity[] {
  const sorted = sortTelegramEntities(entities).filter(
    (entity, index, all) => !isNestedInsideCodeOrPre(entity, index, all),
  );

  return sortTelegramEntities(sorted);
}

function isNestedInsideCodeOrPre(
  entity: MessageEntity,
  index: number,
  entities: readonly MessageEntity[],
): boolean {
  if (entity.type === "code" || entity.type === "pre") {
    return false;
  }

  return entities.some((parent, parentIndex) => {
    if (parentIndex === index || (parent.type !== "code" && parent.type !== "pre")) {
      return false;
    }

    return (
      entity.offset >= parent.offset &&
      entity.offset + entity.length <= parent.offset + parent.length
    );
  });
}

function sortTelegramEntities(entities: readonly MessageEntity[]): readonly MessageEntity[] {
  return [...entities].sort((left, right) => {
    const offset = left.offset - right.offset;
    if (offset !== 0) {
      return offset;
    }

    return right.length - left.length;
  });
}

function renderTelegramMarkdown(
  markdown: string,
  options: RenderTelegramMarkdownOptions,
): TelegramRenderedText {
  const tree = parseMarkdown(
    options.heal === true ? balanceCommonStreamingDelimiters(markdown) : markdown,
  );
  const state: RenderState = { text: "", entities: [] };
  renderRoot(tree, state);

  return {
    text: state.text,
    entities: normalizeTelegramEntities(state.entities.filter((entity) => entity.length > 0)),
  };
}

function parseMarkdown(markdown: string): Root {
  return fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: gfmFromMarkdown(),
  });
}

function balanceCommonStreamingDelimiters(markdown: string): string {
  let healed = markdown;

  if (countUnescaped(healed, "```") % 2 === 1) {
    healed += "\n```";
  }

  if (countUnescaped(healed, "**") % 2 === 1) {
    healed += "**";
  }

  if (countUnescaped(healed, "__") % 2 === 1) {
    healed += "__";
  }

  if (countUnescaped(healed, "~~") % 2 === 1) {
    healed += "~~";
  }

  if (countUnescaped(healed, "`") % 2 === 1) {
    healed += "`";
  }

  return healed;
}

function countUnescaped(value: string, needle: string): number {
  let count = 0;
  let index = 0;

  while (index < value.length) {
    const found = value.indexOf(needle, index);
    if (found === -1) {
      break;
    }

    if (!isEscaped(value, found)) {
      count += 1;
    }

    index = found + needle.length;
  }

  return count;
}

function isEscaped(value: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

function renderRoot(root: Root, state: RenderState): void {
  renderBlocks(root.children, state);
}

function renderBlocks(nodes: readonly Content[], state: RenderState): void {
  nodes.forEach((node, index) => {
    if (index > 0) {
      appendBlockSeparator(state);
    }
    renderBlock(node, state);
  });
}

function renderBlock(node: Content, state: RenderState): void {
  switch (node.type) {
    case "paragraph":
      renderInlineChildren(node, state);
      return;
    case "heading":
      renderHeading(node, state);
      return;
    case "blockquote":
      renderBlockquote(node, state);
      return;
    case "list":
      renderList(node, state);
      return;
    case "code":
      renderCodeBlock(node, state);
      return;
    case "thematicBreak":
      appendText(state, "—");
      return;
    case "html":
      appendText(state, node.value);
      return;
    case "table":
      renderTable(node as Table, state);
      return;
    default:
      renderInlineLike(node, state);
  }
}

function renderInlineLike(node: Content, state: RenderState): void {
  if ("children" in node && Array.isArray(node.children)) {
    renderInlineChildren(node as Parent, state);
    return;
  }

  if ("value" in node && typeof node.value === "string") {
    appendText(state, node.value);
  }
}

function renderInline(node: Content, state: RenderState): void {
  switch (node.type) {
    case "text":
      appendText(state, node.value);
      return;
    case "emphasis":
      withEntity(state, "italic", () => renderInlineChildren(node, state));
      return;
    case "strong":
      withEntity(state, "bold", () => renderInlineChildren(node, state));
      return;
    case "delete":
      withEntity(state, "strikethrough", () => renderInlineChildren(node, state));
      return;
    case "inlineCode":
      withEntity(state, "code", () => appendText(state, node.value));
      return;
    case "break":
      appendText(state, "\n");
      return;
    case "link":
      renderLink(node, state);
      return;
    case "image":
      appendText(state, node.alt ?? node.url);
      return;
    case "html":
      appendText(state, node.value);
      return;
    default:
      renderInlineLike(node, state);
  }
}

function renderInlineChildren(node: Parent, state: RenderState): void {
  for (const child of node.children) {
    renderInline(child, state);
  }
}

function renderHeading(node: Heading, state: RenderState): void {
  withEntity(state, "bold", () => renderInlineChildren(node, state));
}

function renderBlockquote(node: Parent, state: RenderState): void {
  withEntity(state, "blockquote", () => renderBlocks(node.children as Content[], state));
}

function renderList(node: List, state: RenderState): void {
  node.children.forEach((item, index) => {
    if (index > 0) {
      appendText(state, "\n");
    }

    const number = (node.start ?? 1) + index;
    appendText(state, node.ordered === true ? `${number}. ` : "• ");
    renderListItem(item, state);
  });
}

function renderListItem(item: ListItem, state: RenderState): void {
  item.children.forEach((child, index) => {
    if (index > 0) {
      appendText(state, "\n  ");
    }
    renderBlock(child, state);
  });
}

function renderCodeBlock(node: Code, state: RenderState): void {
  const start = state.text.length;
  appendText(state, node.value);
  addEntity(state, {
    type: "pre",
    offset: start,
    length: state.text.length - start,
    ...(node.lang === null || node.lang === undefined || node.lang.length === 0
      ? {}
      : { language: node.lang }),
  });
}

function renderLink(node: Link, state: RenderState): void {
  const start = state.text.length;
  renderInlineChildren(node, state);
  if (state.text.length === start) {
    appendText(state, node.url);
  }

  addEntity(state, {
    type: "text_link",
    offset: start,
    length: state.text.length - start,
    url: node.url,
  });
}

function renderTable(node: Table, state: RenderState): void {
  const rows = node.children.map((row) =>
    row.children.map((cell) => renderPlainChildren(cell)).join(" | "),
  );
  appendText(state, rows.join("\n"));
}

function renderPlainChildren(node: Parent): string {
  const state: RenderState = { text: "", entities: [] };
  renderInlineChildren(node, state);
  return state.text.replaceAll("\n", " ");
}

function withEntity(state: RenderState, type: MessageEntity["type"], render: () => void): void {
  const start = state.text.length;
  render();
  addEntity(state, { type, offset: start, length: state.text.length - start } as MessageEntity);
}

function addEntity(state: RenderState, entity: MessageEntity): void {
  if (entity.length > 0) {
    state.entities.push(entity);
  }
}

function appendText(state: RenderState, text: string): void {
  state.text += text;
}

function appendBlockSeparator(state: RenderState): void {
  if (state.text.length === 0 || state.text.endsWith("\n\n")) {
    return;
  }

  state.text += state.text.endsWith("\n") ? "\n" : "\n\n";
}
