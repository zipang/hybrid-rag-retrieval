#!/usr/bin/env bun
/**
 * acquire-llms-docs.ts
 *
 * Downloads a documentation mirror from an llms.txt index (or llms-full.txt).
 * This is the "Acquire" step of The Librarian workflow.
 *
 * The script:
 *   1. Fetches the index file and extracts every markdown link.
 *   2. Downloads each linked .md file into a target directory, preserving
 *      the URL path structure relative to the index location.
 *   3. Verifies each downloaded file (no JSON error pages, no HTML error
 *      pages, minimum size).
 *   4. Reports a summary.
 *
 * Usage:
 *   bun run acquire-llms-docs.ts <indexUrl> <targetDir> [--dry-run]
 *
 *   indexUrl   URL of the llms.txt (or llms-full.txt) index.
 *   targetDir  Directory that receives the markdown files.
 *   --dry-run  Download nothing. Only list the files the script would fetch.
 */

const [indexUrl, targetDir, ...flags] = process.argv.slice(2);
const DRY_RUN = flags.includes("--dry-run");

if (!indexUrl || !targetDir) {
  console.error("Usage: bun run acquire-llms-docs.ts <indexUrl> <targetDir> [--dry-run]");
  process.exit(1);
}

/** Minimum size in bytes below which a downloaded chapter is rejected. */
const MIN_SIZE = 100;

/** Page URLs that are not raw markdown chapters (API reference, blog). */
function isChapterUrl(url) {
  return /\.md(?:$|[?#])/.test(url) && !/\/reference(?:$|[?#])/.test(url) && !/\/blog\//.test(url);
}

console.log(`Fetching index: ${indexUrl}`);
const indexResp = await fetch(indexUrl);
if (!indexResp.ok) {
  console.error(`Failed to fetch index: HTTP ${indexResp.status}`);
  process.exit(1);
}
const indexText = await indexResp.text();

// Extract markdown links. Handles both bare URLs and markdown [label](url) form.
const urlRe = /\]\(([^)]+\.md[^)]*)\)|(https?:\/\/[^\s)]+\.md[^\s)]*)/g;
const seen = new Set();
const urls = [];
for (const match of indexText.matchAll(urlRe)) {
  const url = (match[1] ?? match[2]).split(/[\s>]/)[0];
  if (!url || !isChapterUrl(url)) continue;
  if (seen.has(url)) continue;
  seen.add(url);
  urls.push(url);
}

console.log(`Found ${urls.length} markdown chapters.`);

if (DRY_RUN) {
  for (const url of urls) console.log(url);
  process.exit(0);
}

let ok = 0;
let rejected = 0;
const rejectedList = [];

for (const url of urls) {
  const path = new URL(url).pathname;
  // Keep only the path relative to the docs root of the URL.
  // The index is served from <host>/docs/llms.txt, chapters from <host>/docs/<path>.
  const relative = path.replace(/^\/docs\//, "").replace(/^\/+/, "");
  const out = `${targetDir}/${relative}`;

  const resp = await fetch(url);
  if (!resp.ok) {
    rejected++;
    rejectedList.push(`${url} (HTTP ${resp.status})`);
    continue;
  }
  const text = await resp.text();

  // Verification: reject JSON error payloads, HTML error pages, tiny files.
  const looksLikeJsonError = /^\s*\{[^}]*"status"\s*:\s*4\d\d/.test(text.trim());
  const looksLikeHtml = /^\s*<!DOCTYPE html>/i.test(text.trim());
  const tooSmall = text.length < MIN_SIZE;

  if (looksLikeJsonError || looksLikeHtml || tooSmall) {
    rejected++;
    rejectedList.push(`${url} (size=${text.length}, jsonError=${looksLikeJsonError}, html=${looksLikeHtml})`);
    continue;
  }

  const dir = out.substring(0, out.lastIndexOf("/"));
  await Bun.write(out, text);
  ok++;
}

console.log(`Downloaded ${ok} chapters.`);
if (rejected > 0) {
  console.log(`Rejected ${rejected}:`);
  for (const r of rejectedList) console.log(`  - ${r}`);
  process.exit(2);
}
console.log("All chapters verified.");
