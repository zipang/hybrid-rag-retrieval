#!/usr/bin/env bun
/**
 * fix-bun-docs.ts
 *
 * Normalizes a local mirror of the Bun documentation (https://bun.com/docs).
 *
 * Fixes two upstream artifacts introduced when the raw Markdown files are
 * downloaded from the official source:
 *
 *  1. Removes the three-line "Documentation Index" blockquote that prefixes
 *     every downloaded page:
 *
 *       > ## Documentation Index
 *       > Fetch the complete documentation index at: https://bun.com/docs/llms.txt
 *       > Use this file to discover all available pages before exploring further.
 *
 *  2. Converts absolute `/docs/...` markdown links into relative links that
 *     resolve inside the local mirror. Example for `runtime/bunfig.md`:
 *
 *       [loaders](/docs/bundler/loaders)  ->  [loaders](../bundler/loaders)
 *
 * The relative prefix depends on the depth of the file inside the mirror.
 * Links inside fenced code blocks are left untouched, as are external URLs
 * (https://...) and the upstream `/docs/docs/...` typos, which are preserved
 * verbatim until the official documentation fixes them.
 *
 * Usage:
 *   bun run fix-bun-docs.ts [mirrorRoot] [--dry-run]
 *
 *   mirrorRoot  Path to the local docs mirror. Defaults to "docs/bun - v1.3.14".
 *   --dry-run   Report what would change without modifying any file.
 */

import { Glob } from "bun";
import { join, relative, dirname } from "node:path";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const MIRROR_ROOT = args.find((a) => !a.startsWith("--")) ?? "docs/bun - v1.3.14";

const HEADER_LINES = [
  "> ## Documentation Index",
  "> Fetch the complete documentation index at: https://bun.com/docs/llms.txt",
  "> Use this file to discover all available pages before exploring further.",
];

/** Matches a markdown link destination starting with /docs/ but NOT the
 *  upstream /docs/docs/... typo. Captures the full destination incl. fragment. */
const DOCS_LINK_RE = /\]\((\/docs\/(?!docs\/)[^)\s]+)\)/g;

let filesScanned = 0;
let filesChanged = 0;
let headersRemoved = 0;
let linksFixed = 0;

for (const file of new Glob("**/*.md").scanSync(MIRROR_ROOT)) {
  const absPath = join(MIRROR_ROOT, file);
  const original = await Bun.file(absPath).text();
  filesScanned++;

  let content = original;

  // 1. Strip the Documentation Index header block (3 lines + following blank line).
  const headerMatch = content.match(
    /^\u003e ## Documentation Index\n\u003e Fetch the complete documentation index at: https:\/\/bun\.com\/docs\/llms\.txt\n\u003e Use this file to discover all available pages before exploring further\.\n\n?/
  );
  if (headerMatch) {
    content = content.slice(headerMatch[0].length);
    headersRemoved++;
  }

  // 2. Rewrite /docs/... links to relative links based on file depth.
  const relativeDir = relative(MIRROR_ROOT, dirname(absPath));
  const depth = relativeDir === "" ? 0 : relativeDir.split("/").length;
  const prefix = "../".repeat(depth);

  let inFence = false;
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Track fenced code blocks (``` or ~~~) to leave their content untouched.
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    if (DOCS_LINK_RE.test(line)) {
      DOCS_LINK_RE.lastIndex = 0;
      lines[i] = line.replace(DOCS_LINK_RE, (_m, dest) => {
        const target = dest.slice("/docs/".length);
        linksFixed++;
        return `](${prefix}${target})`;
      });
    }
  }
  content = lines.join("\n");

  if (content !== original) {
    filesChanged++;
    if (!DRY_RUN) {
      await Bun.write(absPath, content);
    }
  }
}

console.log(`Scanned ${filesScanned} files in ${MIRROR_ROOT}`);
console.log(`Headers removed : ${headersRemoved}`);
console.log(`Links fixed     : ${linksFixed}`);
console.log(`Files changed   : ${filesChanged}`);
console.log(DRY_RUN ? "DRY-RUN: no file was modified." : "Done.");
