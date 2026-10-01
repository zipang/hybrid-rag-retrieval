# IMPORTANT RULES

These project rules take precedence over tool-specific rules.

## Always verify against the latest official documentation

New versions of our tools ship new features quickly. A recipe that was valid a
few months ago can be obsolete today. Before you design, implement, or debug
with a tool, verify its behavior against the latest official documentation.

- Prefer the official documentation of the tool version that the project pins.
- Read the release notes and API reference of the current version. Do not rely
  on memory, on older tutorials, or on blog posts.
- When a documented feature replaces custom code, use the documented feature.
- Mirror official documentation locally with the `librarian` agent and the
  `index-tool-docs` skill, under `docs/<tool> - <version>/`, and read the local
  mirror before you use web search. Use `fix-bun-docs` to normalize a Bun mirror
  after acquisition.
- When a newer version is available, reindex the local mirror and advertise the
  new version in the `LOCAL DOCUMENTATION FOR TOOLS` section below.

## Explain technical terms with a glossary

A written document that a less technical reader must follow ends with a
`## Glossary` section. Add the glossary when the document uses a specialized
or ambiguous term.

- Define the term in plain words, in one or two short sentences.
- Sort the entries alphabetically.
- Keep one name for one thing. When two names exist for the same concept,
  choose one and put it in the glossary.
- Keep the project glossary in the root `README.md` when a term has a special
  meaning for the project.
- The `memos/` directory holds the memos. Every memo ends with a glossary.

## Read the README and AGENTS files

- `README.md` files live at key directory roots. They describe the content and the rules of each directory. They are for humans and agents.
- `AGENTS.md` files sit next to `README.md` files. They hold instructions for AI agents that edit, create, or update content in that directory.
- Before you edit a file, read the `README.md` and `AGENTS.md` files in the enclosing directories.
- **IMPORTANT:** A rule in a subdirectory takes precedence over a rule in a parent directory.
- If there is no `README.md` or `AGENTS.md` file in the directory where you edit the file, then _apply the unchanged rules of the parents directories_.
- When we introduce new conventions and rules in a directory, update `README.md` for human informations and `AGENTS.md` for agent-only rules.
- _Always use english_ with the `technical-writing` skill to author and update the `README.md` and `AGENTS.md` content as well as the JSDoc (english is the universal language for documentation).

## Always use Bun for TypeScript and JavaScript

Use Bun instead of Node.js.
For instance:

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`.
- Use `bun test` instead of `jest` or `vitest`.
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`.
- Use `bun install` instead of `npm install`, `yarn install`, or `pnpm install`.
- Use `bun run <script>` instead of `npm run`, `yarn run`, or `pnpm run`.
- Use `bunx <package> <command>` instead of `npx <package> <command>`.
- Bun loads `.env` automatically. Do not use `dotenv`.

### Bun APIs

Bun 1.4 ships built-in APIs that replace many popular npm packages. Prefer them unless you need a feature they lack, so the project stays dependency-light.

**Runtime, I/O, and networking**

- `Bun.serve()` supports WebSockets, HTTPS, routes, static file serving, and (experimental) HTTP/3. Do not use `express`, `serve-static`, or `sirv`.
- Prefer `Bun.file` over `readFile` and `writeFile` from `node:fs`.
- Prefer native `ReadableStream`, `WritableStream`, `TransformStream`, `CompressionStream`, `DecompressionStream`, `TextDecoderStream`, and `TextEncoderStream` over `node:zlib` streams or `pako`.
- `WebSocket` is built in. Do not use `ws`.
- Use `URLPattern` for route matching instead of `path-to-regexp`.

**Data formats**

- `Bun.JSON5.parse()` / `stringify()` instead of `json5`; import `.json5` files directly.
- `Bun.JSONC.parse()` instead of `jsonc-parser`.
- `Bun.JSONL.parse()` / `parseChunk()` instead of `ndjson`.
- `Bun.TOML` instead of `@iarna/toml`.
- `Bun.YAML` instead of `js-yaml`.
- `Bun.XML` instead of `fast-xml-parser` and `xml2js`.
- `Bun.Archive` to create and extract tarballs instead of `tar`.

**Images and browsers**

- `Bun.Image` to decode, resize, rotate, and encode JPEG, PNG, WebP, GIF, and BMP (HEIC, AVIF, and TIFF on macOS/Windows), and to read `width`, `height`, and `format` with `.metadata()`. Do not use `sharp`, `jimp`, or `image-size`.
- `Bun.WebView` for headless browser automation (navigate, click, evaluate, screenshot). Prefer it over `puppeteer` or `playwright` for simple automation.

**Text and terminal**

- `Bun.markdown` to render Markdown to HTML (`.html()`), React (`.react()`), or custom output such as ANSI (`.render()`). Do not use `marked`, `markdown-it`, or `remark` for plain rendering. `bun ./README.md` renders a file in the terminal without `glow`.
- `Bun.sliceAnsi()`, `Bun.wrapAnsi()`, and `Bun.stringWidth()` for ANSI- and grapheme-aware terminal text instead of `slice-ansi`, `cli-truncate`, `wrap-ansi`, and `string-width`.
- `Bun.spawn(..., { terminal })` (backed by `Bun.Terminal`) for PTY control instead of `node-pty`.

**Scheduling and concurrency**

- `Bun.cron()` to register OS-level scheduled jobs instead of `node-cron`, `cron`, or `node-schedule`.
- `bun run --parallel` (and `--sequential`) to run `package.json` scripts concurrently instead of `concurrently` or `npm-run-all`.

**Databases**

- Use `bun:sqlite` for SQLite. Do not use `better-sqlite3`.
- Use `Bun.redis` for Redis. Do not use `ioredis`.
- Use `Bun.sql` for Postgres. Do not use `pg` or `postgres.js`.

**Subprocesses and shell**

- Use `Bun.$`ls`` instead of `execa`.

**Diagnostics**

- `bun --cpu-prof` / `--cpu-prof-md` and `bun --heap-prof` / `--heap-prof-md` profile CPU and memory; the `-md` variants are LLM-friendly.
- `process.on("memoryPressure", ...)` frees caches when the OS reports low memory.

### Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

### Temporary: HTML to Markdown conversion

`Bun.markdown.fromHTML()` is not in Bun 1.4.2. It is an open pull request (oven-sh/bun#41527).

- `src/markdown/from-html.ts` calls the native API when the running Bun provides it.
- When the native API is missing, the module runs `src/markdown/from-html-bridge.ts` with the `bun-41527` binary through a subprocess. Set `BUN_HTML_BIN` to use another binary.
- Install the pull request build with `bunx bun-pr 41527`.
- When the pull request merges, delete `from-html-bridge.ts` and the fallback path in `from-html.ts`.

## Formatting and linting

The project uses **Biome** (`biome.jsonc` and `.editorconfig`). Use **tabs** for every file except Markdown (`.md`), which uses 2 spaces.

- Run `bunx biome check --write <files>` to format and lint the files you just edited.
- Run `bunx biome check --write .` to format and lint the whole project.

Before you use the `git-commit` skill, reformat the edited sources with Biome. This keeps the commit limited to meaningful changes.

## JS and TS lint rules

- IMPORTANT: Declare a proper JSDoc block for every function.
- Leave a blank line before control statements like : `if`, loops (`while`, `for`..) and `return` to make the code more readable
- Prefer arrow function definitions: `const fn = () => {}`. Do not use the `function` keyword.

## LOCAL DOCUMENTATION FOR TOOLS

- [Qdrant - 1.19.1](./docs/Qdrant%20-%201.19.1/index.md) Open-source vector search engine used for the hybrid dense+sparse retrieval index.
  Anytime you must generate code or instructions to use these tools in the
  project, you **MUST** refer to this local documentation first. This will
  ensure efficiency, low latency, and conformance to the version of the tool
  actually used inside the project. Preload the `index.md` content of each
  available documentation to keep this in your context for rapid access.
