import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { renderMarkdown, stripFrontmatter, type MarkdownOptions } from "../src/markdown.tsx";

/** Renders note markdown to static HTML, which is exactly what the reader mounts. */
function html(markdown: string, options: MarkdownOptions = {}): string {
  return renderToStaticMarkup(<>{renderMarkdown(markdown, options)}</>);
}

const vault = {
  resolveWikilink: (target: string) => (target === "daily" ? "notes/daily.md" : null),
  onOpenNote: () => {},
};

describe("renderMarkdown — blocks", () => {
  it("clamps heading levels below the dialog title", () => {
    assert.equal(
      html("# One\n\n## Two\n\n### Three\n\n#### Four"),
      '<h3 class="md-heading" data-heading="one">One</h3>' +
        '<h3 class="md-heading" data-heading="two">Two</h3>' +
        '<h4 class="md-heading" data-heading="three">Three</h4>' +
        '<h5 class="md-heading" data-heading="four">Four</h5>',
    );
  });

  it("gives every heading a slug a `[[Note#Heading]]` can address", () => {
    const out = html("## What's next?\n\n## Use `fs` and **care**");
    assert.match(out, /data-heading="whats-next"/);
    assert.match(out, /data-heading="use-fs-and-care"/);
  });

  it("marks only the first heading a jump asked for", () => {
    const out = html("## Notes\n\n## Notes\n\n## Other", { highlightHeading: "Notes" });
    assert.equal((out.match(/is-target/g) ?? []).length, 1);
    assert.match(out, /<h3 class="md-heading is-target" data-heading="notes">Notes<\/h3>/);
    assert.match(out, /<h3 class="md-heading" data-heading="notes">Notes<\/h3>/);
  });

  it("accepts the slug form in the link and ignores an unknown heading", () => {
    assert.match(html("## My Heading", { highlightHeading: "my-heading" }), /is-target/);
    assert.equal(html("## My Heading", { highlightHeading: "elsewhere" }).includes("is-target"), false);
  });

  it("joins wrapped paragraph lines and splits on blank lines", () => {
    assert.equal(html("one\ntwo\n\nthree"), '<p class="md-para">one two</p><p class="md-para">three</p>');
  });

  it("renders unordered and ordered lists", () => {
    assert.equal(
      html("- one\n- two\n\n1. first\n2. second"),
      '<ul class="md-list"><li>one</li><li>two</li></ul>' +
        '<ol class="md-list"><li>first</li><li>second</li></ol>',
    );
  });

  it("renders quotes and rules", () => {
    assert.equal(
      html("> one\n> two\n\nafter\n\n---\n\nlast"),
      '<blockquote class="md-quote">one two</blockquote>' +
        '<p class="md-para">after</p>' +
        '<hr class="md-rule"/>' +
        '<p class="md-para">last</p>',
    );
  });

  it("keeps fenced code verbatim, including blank lines and markers", () => {
    const out = html("```ts\nconst a = **x**;\n\nline two\n```");
    assert.equal(out, '<pre class="md-pre"><code>const a = **x**;\n\nline two</code></pre>');
    assert.ok(!out.includes("<strong>"), "code is not parsed as emphasis");
  });

  it("drops frontmatter before rendering", () => {
    const out = html("---\ntitle: Private\narea: career\n---\n\n# Body text");
    assert.equal(out, '<h3 class="md-heading" data-heading="body-text">Body text</h3>');
    assert.ok(!out.includes("Private"));
  });
});

describe("renderMarkdown — inline", () => {
  it("renders bold, italic and inline code", () => {
    assert.equal(
      html("**bold** and *italic* and __bold__ and _italic_ and `code`"),
      '<p class="md-para"><strong>bold</strong> and <em>italic</em> and <strong>bold</strong> and ' +
        '<em>italic</em> and <code class="md-code">code</code></p>',
    );
  });

  it("renders inline markup inside headings", () => {
    assert.equal(
      html("## Use `fs`"),
      '<h3 class="md-heading" data-heading="use-fs">Use <code class="md-code">fs</code></h3>',
    );
  });

  it("only turns http(s) links into anchors", () => {
    assert.equal(
      html("[site](https://example.com/a?b=1)"),
      '<p class="md-para"><a class="md-link" href="https://example.com/a?b=1" ' +
        'target="_blank" rel="noreferrer noopener">site</a></p>',
    );
    assert.equal(html("[click](javascript:alert)"), '<p class="md-para">click</p>');
    assert.equal(html("[relative](./other.md)"), '<p class="md-para">relative</p>');
    assert.equal(html("[data](data:text/html;base64,abc)"), '<p class="md-para">data</p>');
  });

  it("escapes raw HTML in note text", () => {
    const out = html("Hello <script>alert(1)</script>");
    assert.equal(out, '<p class="md-para">Hello &lt;script&gt;alert(1)&lt;/script&gt;</p>');
    assert.ok(!out.includes("<script"), "no live script tag");
  });
});

describe("renderMarkdown — wikilinks", () => {
  it("renders a resolved link as a button that opens the note", () => {
    assert.equal(
      html("See [[daily]] now.", vault),
      '<p class="md-para">See <button type="button" class="md-wikilink" ' +
        'title="Open notes/daily.md">daily</button> now.</p>',
    );
  });

  it("renders an unresolved link as inert text", () => {
    assert.equal(
      html("See [[missing]] now.", vault),
      '<p class="md-para">See <span class="md-wikilink is-unresolved" ' +
        'title="Not in the vault index">missing</span> now.</p>',
    );
  });

  it("stays inert when the reader cannot open notes", () => {
    const out = html("[[daily]]", { resolveWikilink: vault.resolveWikilink });
    assert.match(out, /class="md-wikilink is-unresolved"/);
    assert.ok(!out.includes("<button"));
  });

  it("carries the heading into the reader's title", () => {
    assert.match(
      html("[[daily#Morning]]", vault),
      /title="Open notes\/daily\.md at “Morning”"/,
    );
  });

  it("uses the alias as the label and resolves the bare target", () => {
    const seen: string[] = [];
    const options = {
      resolveWikilink: (target: string) => {
        seen.push(target);
        return target === "daily" ? "notes/daily.md" : null;
      },
      onOpenNote: () => {},
    };
    const out = html("[[daily#Morning|Today]]", options);
    assert.deepEqual(seen, ["daily"]);
    assert.match(out, /<button[^>]*>Today<\/button>/);
  });

  it("keeps a backslash-escaped opening as literal text", () => {
    assert.equal(html("\\[[daily]]", vault), '<p class="md-para">[[daily]]</p>');
  });

  it("leaves a backslash that escapes nothing alone", () => {
    assert.equal(html("C:\\Users\\me"), '<p class="md-para">C:\\Users\\me</p>');
  });

  it("keeps an escaped separator inside the target", () => {
    const out = html("[[a\\|b]]", vault);
    assert.match(out, /class="md-wikilink is-unresolved"/);
    assert.ok(out.includes(">a|b</span>"), "the pipe is shown literally");
    assert.ok(!out.includes("\\|"), "the escape is consumed, not printed");
  });

  it("keeps every pipe after the first in the alias", () => {
    assert.match(html("[[daily|Today|Now]]", vault), /<button[^>]*>Today\|Now<\/button>/);
  });

  it("falls back to the target when the alias is blank", () => {
    assert.match(html("[[daily|]]", vault), /<button[^>]*>daily<\/button>/);
  });

  it("shows a heading-only link as text and does not resolve it", () => {
    const seen: string[] = [];
    const out = html("[[#Morning]]", {
      resolveWikilink: (target: string) => {
        seen.push(target);
        return "notes/daily.md";
      },
      onOpenNote: () => {},
    });
    assert.deepEqual(seen, [], "there is no target to resolve");
    assert.equal(
      out,
      '<p class="md-para"><span class="md-wikilink is-unresolved" ' +
        'title="Not in the vault index">Morning</span></p>',
    );
  });
});

describe("stripFrontmatter", () => {
  it("removes a leading frontmatter block", () => {
    assert.equal(stripFrontmatter("---\ntitle: x\n---\nbody"), "body");
  });

  it("leaves notes without frontmatter alone", () => {
    assert.equal(stripFrontmatter("# Hi"), "# Hi");
  });

  it("leaves an unterminated block alone rather than eating the note", () => {
    assert.equal(stripFrontmatter("---\ntitle: x"), "---\ntitle: x");
  });
});
