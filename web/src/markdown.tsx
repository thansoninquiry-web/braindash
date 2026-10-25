import type { ReactNode } from "react";
import { parseWikilink, WIKILINK_TOKEN_SOURCE } from "../../shared/wikilinks";
import { headingSlug } from "./headingTarget";

export interface MarkdownOptions {
  /** Resolves a `[[wikilink]]` target to a vault path, or null when unknown. */
  resolveWikilink?: (target: string) => string | null;
  /**
   * Called when a wikilink that resolves is activated. The second argument is
   * `[[Note#Heading]]`'s heading, so the reader can land on that heading after
   * the note loads; null when the link names none.
   */
  onOpenNote?: (path: string, heading?: string | null) => void;
  /** Heading to mark as freshly arrived at, after a link jumps into a note. */
  highlightHeading?: string | null;
}

/**
 * A deliberately small markdown subset: headings, paragraphs, lists, quotes,
 * fenced code, rules, `code`, **bold**, *italic*, `[text](url)` and
 * `[[wikilinks]]`. Everything becomes React nodes, never HTML, so a note cannot
 * inject markup into the dashboard.
 */
type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "code"; lines: string[] }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; lines: string[] }
  | { kind: "rule" }
  | { kind: "para"; lines: string[] };

/**
 * Wiki links and inline emphasis, scanned left to right. The escape alternative
 * comes first so `\[[not a link]]` stays text; the wikilink alternative is the
 * shared token grammar, so the reader accepts exactly what the server extracts.
 */
const INLINE_SOURCE =
  // Only punctuation is escapable, so `C:\\Users` keeps its backslash.
  "(\\\\(?:[\\\\`*_{}\\[\\]()#+\\-.!|>]))" +
  "|(`[^`]+`)" +
  "|(\\*\\*[^*]+\\*\\*)" +
  "|(__[^_]+__)" +
  "|(\\*[^*]+\\*)" +
  "|(_[^_]+_)" +
  `|(${WIKILINK_TOKEN_SOURCE})` +
  "|(\\[[^\\]]+\\]\\([^)\\s]+\\))";

/** Drops a leading frontmatter block; the dashboard shows it as metadata. */
export function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith("---")) return markdown;
  const end = markdown.indexOf("\n---", 3);
  if (end === -1) return markdown;
  return markdown.slice(markdown.indexOf("\n", end + 1) + 1);
}

function parseBlocks(markdown: string): Block[] {
  const lines = stripFrontmatter(markdown).split(/\r?\n/);
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  function flushParagraph() {
    if (paragraph.length > 0) {
      blocks.push({ kind: "para", lines: paragraph });
      paragraph = [];
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    const fence = /^```(\w*)/.exec(trimmed);
    if (fence) {
      flushParagraph();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      blocks.push({ kind: "code", lines: codeLines });
      continue;
    }

    if (trimmed === "") {
      flushParagraph();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading?.[1] && heading[2] !== undefined) {
      flushParagraph();
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2].trim() });
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      blocks.push({ kind: "rule" });
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (bullet?.[1] !== undefined || numbered?.[1] !== undefined) {
      flushParagraph();
      const ordered = numbered?.[1] !== undefined;
      const items: string[] = [];
      const isItem = (value: string) =>
        ordered ? /^\d+[.)]\s+/.test(value) : /^[-*+]\s+/.test(value);
      let cursor = index;
      while (cursor < lines.length) {
        const next = (lines[cursor] ?? "").trim();
        if (!isItem(next)) break;
        items.push(next.replace(ordered ? /^\d+[.)]\s+/ : /^[-*+]\s+/, ""));
        cursor += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      index = cursor - 1;
      continue;
    }

    if (trimmed.startsWith(">")) {
      flushParagraph();
      const quoteLines: string[] = [];
      let cursor = index;
      while (cursor < lines.length && (lines[cursor] ?? "").trim().startsWith(">")) {
        quoteLines.push((lines[cursor] ?? "").trim().replace(/^>\s?/, ""));
        cursor += 1;
      }
      blocks.push({ kind: "quote", lines: quoteLines });
      index = cursor - 1;
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  return blocks;
}

function renderWikilink(inner: string, options: MarkdownOptions, key: string): ReactNode {
  const link = parseWikilink(inner);
  if (!link) return null;
  // The heading and alias never take part in resolution; only the target does.
  const resolved = link.target ? options.resolveWikilink?.(link.target) ?? null : null;
  if (resolved && options.onOpenNote) {
    return (
      <button
        key={key}
        type="button"
        className="md-wikilink"
        onClick={() => options.onOpenNote?.(resolved, link.heading)}
        title={link.heading ? `Open ${resolved} at “${link.heading}”` : `Open ${resolved}`}
      >
        {link.label}
      </button>
    );
  }
  return (
    <span key={key} className="md-wikilink is-unresolved" title="Not in the vault index">
      {link.label}
    </span>
  );
}

function renderLink(token: string, key: string): ReactNode {
  const match = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
  if (!match?.[1] || !match[2]) return token;
  const [, label, href] = match;
  // Only web links become anchors: javascript:, data: and relatives stay inert text.
  if (!/^https?:\/\//i.test(href)) return label;
  return (
    <a key={key} className="md-link" href={href} target="_blank" rel="noreferrer noopener">
      {label}
    </a>
  );
}

function renderInline(text: string, options: MarkdownOptions, key: string): ReactNode[] {
  // A fresh regex per call: this function recurses for bold/italic runs.
  const pattern = new RegExp(INLINE_SOURCE, "g");
  const nodes: ReactNode[] = [];
  let last = 0;
  let counter = 0;

  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const tokenKey = `${key}-i${counter++}`;
    if (token.startsWith("\\") && token.length === 2) {
      // An escaped character is text, without its backslash: `\*` shows `*`.
      nodes.push(token.slice(1));
    } else if (token.startsWith("`")) {
      nodes.push(
        <code key={tokenKey} className="md-code">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(<strong key={tokenKey}>{renderInline(token.slice(2, -2), options, tokenKey)}</strong>);
    } else if (token.startsWith("[[")) {
      nodes.push(renderWikilink(token.slice(2, -2), options, tokenKey));
    } else if (token.startsWith("[")) {
      nodes.push(renderLink(token, tokenKey));
    } else {
      nodes.push(<em key={tokenKey}>{renderInline(token.slice(1, -1), options, tokenKey)}</em>);
    }
    last = match.index + token.length;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** Renders note markdown as React nodes. */
export function renderMarkdown(markdown: string, options: MarkdownOptions = {}): ReactNode {
  const blocks = parseBlocks(markdown);
  const target = options.highlightHeading ? headingSlug(options.highlightHeading) : "";
  // A note may repeat a heading (`## Notes` under two sections). Only the first
  // matching element is the jump target, so only that one is highlighted.
  const seen = new Set<string>();
  return blocks.map((block, index) => {
    const key = `b${index}`;
    switch (block.kind) {
      case "heading": {
        // Kept below the dialog's own heading so the outline stays sane.
        const Tag = block.level <= 2 ? "h3" : block.level === 3 ? "h4" : "h5";
        const slug = headingSlug(block.text);
        const first = !seen.has(slug);
        seen.add(slug);
        const isTarget = Boolean(target) && first && slug === target;
        return (
          <Tag
            key={key}
            className={`md-heading${isTarget ? " is-target" : ""}`}
            data-heading={slug}
          >
            {renderInline(block.text, options, key)}
          </Tag>
        );
      }
      case "code":
        return (
          <pre key={key} className="md-pre">
            <code>{block.lines.join("\n")}</code>
          </pre>
        );
      case "list": {
        const items = block.items.map((item, itemIndex) => (
          <li key={`${key}-${itemIndex}`}>{renderInline(item, options, `${key}-${itemIndex}`)}</li>
        ));
        return block.ordered ? (
          <ol key={key} className="md-list">
            {items}
          </ol>
        ) : (
          <ul key={key} className="md-list">
            {items}
          </ul>
        );
      }
      case "quote":
        return (
          <blockquote key={key} className="md-quote">
            {renderInline(block.lines.join(" "), options, key)}
          </blockquote>
        );
      case "rule":
        return <hr key={key} className="md-rule" />;
      default:
        return (
          <p key={key} className="md-para">
            {renderInline(block.lines.join(" "), options, key)}
          </p>
        );
    }
  });
}
