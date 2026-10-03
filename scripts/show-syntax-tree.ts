/**
 * Inspect the syntax tree of a sentence.
 *
 * The script parses one sentence with the configured UDPipe model and prints
 * the result twice:
 *
 * - a flat table, one row per token, in the CoNLL-U field order;
 * - a tree, one line per token, with the governor above its dependents.
 *
 * Run it with:
 *
 * ```sh
 * bun run show-syntax-tree "Le garcon regarde le soleil"
 * ```
 *
 * The parser reads the model path from `UDPIPE_MODEL_PATH`, or falls back to
 * the default path under `models/`. Run `bun run init` to download the model.
 */

import { createSyntaxParser } from "../src/lib/syntax/config"
import type { ParsedSentence, ParsedToken } from "../src/lib/syntax/parser"

/** The flat-table columns, in the order the specification lists them. */
const TABLE_HEADERS = ["ID", "FORM", "LEMMA", "UPOS", "HEAD", "DEPREL", "FEATS"]

/** One flat-table row, aligned with {@link TABLE_HEADERS}. */
type TableRow = [string, string, string, string, string, string, string]

/** One display value: an empty CoNLL-U field becomes a single underscore. */
const display = (value: string): string => (value === "" ? "_" : value)

/** Build one flat-table row from one token and its 1-based index. */
const tableRow = (token: ParsedToken, index: number): TableRow => [
	String(index + 1),
	display(token[0]),
	display(token[1]),
	display(token[2]),
	String(token[3]),
	display(token[4]),
	display(token[5]),
]

/** Pad every cell to its column width and join the rows with a separator. */
const formatTable = (headers: readonly string[], rows: readonly TableRow[]): string => {
	const widths = headers.map((header, column) =>
		Math.max(header.length, ...rows.map((row) => row[column]?.length ?? 0)),
	)
	const renderRow = (row: readonly string[]): string =>
		`| ${row.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join(" | ")} |`
	const separator = `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`

	return [renderRow(headers), separator, ...rows.map(renderRow)].join("\n")
}

/** Map a governor index to its dependent indices, in reading order. */
const dependents = (sentence: ParsedSentence): Map<number, number[]> => {
	const map = new Map<number, number[]>()

	for (const [offset, token] of sentence.entries()) {
		const list = map.get(token[3]) ?? []

		list.push(offset + 1)
		map.set(token[3], list)
	}

	return map
}

/** Format one node, for example `regarde (VERB, root)`. */
const nodeLabel = (token: ParsedToken): string => `${token[0]} (${token[2]}, ${token[4]})`

/** Render one sentence as an indented tree under its roots. */
const formatTree = (sentence: ParsedSentence): string => {
	const children = dependents(sentence)
	const lines: string[] = []

	const visit = (index: number, connector: string, childPrefix: string): void => {
		const token = sentence[index - 1]

		if (token === undefined) {
			return
		}

		lines.push(`${connector}${nodeLabel(token)}`)

		const kids = children.get(index) ?? []

		kids.forEach((child, position) => {
			const last = position === kids.length - 1

			visit(
				child,
				`${childPrefix}${last ? "└── " : "├── "}`,
				`${childPrefix}${last ? "    " : "│   "}`,
			)
		})
	}

	for (const root of children.get(0) ?? []) {
		visit(root, "", "")
	}

	return lines.join("\n")
}

/** Print the flat table and the tree for every parsed sentence. */
const printParse = (sentences: ParsedSentence[]): void => {
	sentences.forEach((sentence, index) => {
		const text = sentence.map((token) => token[0]).join(" ")

		console.log(`\nSentence ${index + 1}: ${text}`)
		console.log("\nFlat table:")
		console.log(formatTable(TABLE_HEADERS, sentence.map(tableRow)))
		console.log("\nTree:")
		console.log(formatTree(sentence))
	})
}

/** Run the command-line tool. */
const main = async (): Promise<void> => {
	const text = process.argv.slice(2).join(" ").trim()

	if (text === "") {
		console.error('usage: bun run show-syntax-tree "<sentence>"')
		process.exitCode = 1

		return
	}

	const parser = createSyntaxParser(process.env)
	const parsed = await parser.parse(text)

	printParse(parsed.sentences)
}

if (import.meta.main) {
	await main()
}
