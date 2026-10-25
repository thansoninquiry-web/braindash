/**
 * The path a person types when creating a note. The server has the final word
 * (and re-checks containment), but catching the obvious mistakes here turns a
 * 400 into a sentence beside the field.
 */
export type NotePathCheck =
  | { path: string; error: null }
  | { path: null; error: string };

export function normaliseNotePath(input: string): NotePathCheck {
  const trimmed = input.trim().replace(/\\/g, "/");
  if (!trimmed) {
    return { path: null, error: "Give the note a path, for example notes/new-idea.md" };
  }
  if (/^[A-Za-z]:/.test(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("~")) {
    return { path: null, error: "Use a vault-relative path, not an absolute one" };
  }

  const segments = trimmed.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.length === 0) {
    return { path: null, error: "Give the note a path, for example notes/new-idea.md" };
  }
  if (segments.some((segment) => segment === "..")) {
    return { path: null, error: "A note cannot be created outside the vault" };
  }
  if (segments.some((segment) => segment.startsWith("."))) {
    return { path: null, error: "Hidden folders are outside the vault index" };
  }

  const last = segments[segments.length - 1] as string;
  const file = last.toLowerCase().endsWith(".md") ? last : `${last}.md`;
  return { path: [...segments.slice(0, -1), file].join("/"), error: null };
}
