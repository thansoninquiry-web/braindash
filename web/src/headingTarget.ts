import { parseWikilink } from "../../shared/wikilinks";

/**
 * Matching a `[[Note#Heading]]` to the heading the reader renders.
 *
 * The link is written by a person and the heading by the markdown parser, so the
 * two texts differ in ways nobody thinks about while typing: case, runs of
 * whitespace, inline emphasis or code in the heading, punctuation, a wikilink
 * inside the heading, and whether the author typed the slug (`#my-heading`) or
 * the words (`#My Heading`). One normalisation answers all of them, and the same
 * function builds the `data-heading` attribute on every rendered heading, so
 * link and target cannot drift apart.
 */

/** Markdown emphasis/code markers, which are structure rather than heading text. */
function stripInline(text: string): string {
  return text
    // `[[Target|label]]` in a heading reads as its label, not its brackets.
    .replace(/\[\[([^\]]*?)\]\]/g, (_match: string, inner: string) => parseWikilink(inner)?.label ?? inner)
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1");
}

/**
 * The comparable form of a heading: lowercased, punctuation removed (so
 * `What's next?` and `Whats next` agree), whitespace folded to single dashes,
 * and outer dashes trimmed. Unicode letters and digits survive, so headings in
 * any language keep their identity.
 */
export function headingSlug(text: string): string {
  return stripInline(text)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}
