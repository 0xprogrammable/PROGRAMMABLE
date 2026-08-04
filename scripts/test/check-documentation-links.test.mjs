import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { collectDocumentationLinkErrors } from "../check-documentation-links.mjs";

test("a missing inline Markdown link remains a hard failure", (t) => {
  const root = fixture(t, "Read the [missing document](missing.md).\n");
  assert.deepEqual(collectDocumentationLinkErrors(root), ["README.md: missing missing.md"]);
});

test("Markdown and HTML pseudo-links inside a backtick fence are inert", (t) => {
  const root = fixture(t, [
    "# Example",
    "",
    "```text",
    "[not a link](missing.md)",
    '<img src="src">',
    '<a href="also-missing.md">example</a>',
    "```",
    ""
  ].join("\n"));
  assert.deepEqual(collectDocumentationLinkErrors(root), []);
});

test("a real HTML attribute outside a fence remains a hard failure", (t) => {
  const root = fixture(t, '<img src="missing.png" alt="Missing">\n');
  assert.deepEqual(collectDocumentationLinkErrors(root), ["README.md: missing missing.png"]);
});

test("pseudo HTML attributes and links inside inline code spans are inert", (t) => {
  const root = fixture(t, [
    'The config freezes `src="missing-src"` and `[example](missing.md)`.',
    'A double span can contain a shorter delimiter: `` `src="also-missing"` ``.',
    ""
  ].join("\n"));
  assert.deepEqual(collectDocumentationLinkErrors(root), []);
});

test("an unmatched inline-code delimiter does not hide a later real link", (t) => {
  const root = fixture(t, "An unmatched ` delimiter precedes a [missing link](missing.md).\n");
  assert.deepEqual(collectDocumentationLinkErrors(root), ["README.md: missing missing.md"]);
});

test("tilde fences and longer variable-length fences mask their complete contents", (t) => {
  const root = fixture(t, [
    "~~~~html",
    '<a href="tilde-missing.md">example</a>',
    "~~~",
    '[still fenced](still-missing.md)',
    "~~~~~~",
    "",
    "````markdown",
    "```text",
    '[also fenced](another-missing.md)',
    "```",
    "````",
    ""
  ].join("\n"));
  assert.deepEqual(collectDocumentationLinkErrors(root), []);
});

test("an unclosed fence remains code through end of file while earlier links are checked", (t) => {
  const root = fixture(t, [
    "A real [existing link](target.md).",
    "",
    "```text",
    '[fenced until EOF](missing.md)',
    '<img src="also-missing.png">'
  ].join("\n"), { "target.md": "# Target\n" });
  assert.deepEqual(collectDocumentationLinkErrors(root), []);
});

test("links after a closed fence are checked normally", (t) => {
  const root = fixture(t, [
    "```text",
    '[fenced](ignored.md)',
    "```",
    "A real [missing link](outside.md).",
    ""
  ].join("\n"));
  assert.deepEqual(collectDocumentationLinkErrors(root), ["README.md: missing outside.md"]);
});

test("vendored dependency documentation under node_modules is outside repository documentation scope", (t) => {
  const root = fixture(t, "A real [existing link](target.md).\n", { "target.md": "# Target\n" });
  const vendoredReadme = path.join(root, "node_modules", "example", "README.md");
  fs.mkdirSync(path.dirname(vendoredReadme), { recursive: true });
  fs.writeFileSync(vendoredReadme, "[dependency-local link](missing-upstream-file.md)\n");
  assert.deepEqual(collectDocumentationLinkErrors(root), []);
});

function fixture(t, markdown, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "documentation-links-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "README.md"), markdown);
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
  return root;
}
