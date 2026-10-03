/**
 * Compare two sentences by their syntax score.
 *
 * The script parses both sentences with the configured UDPipe model, abstracts
 * each tree, encodes the coarse structure, and prints the frozen syntax
 * similarity of the two vectors.
 *
 * Run it with two quoted sentences:
 *
 * ```sh
 * bun run compare-syntax "Le garçon regarde le soleil" "Un chat mange une souris"
 * ```
 *
 * The score is one when the two trees are isomorphic and below one when the
 * structure differs. A statement, a question, and an exclamation with the same
 * words stay apart, because the encoder keeps the punctuation marks.
 *
 * The parser reads the model path from `UDPIPE_MODEL_PATH`, or falls back to
 * the default path under `models/`. Run `bun run init` to download the model.
 */

import { multivectorSimilarity } from "../src/lib/scoring"
import { type AbstractTree, abstractTree, type SyntaxMode } from "../src/lib/syntax/abstraction"
import { createSyntaxParser } from "../src/lib/syntax/config"
import { DEFAULT_ENCODER_CONFIG, encodeTree } from "../src/lib/syntax/encoder"

/** The score at or above which two trees count as identical. */
const IDENTICAL_SCORE = 0.999999

/** Parse the `--mode` flag. Defaults to `coarse`. */
const parseMode = (argv: readonly string[]): SyntaxMode => {
	const index = argv.indexOf("--mode")
	const value = index === -1 ? "coarse" : argv[index + 1]

	if (value !== "coarse") {
		throw new Error(`unknown or deferred mode "${value ?? ""}"; only "coarse" is available`)
	}

	return value
}

/** Return the two sentence arguments, without the `--mode` option pair. */
const sentenceArgs = (argv: readonly string[]): string[] => {
	const args: string[] = []

	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index]

		if (value === "--mode") {
			index += 1

			continue
		}

		args.push(value ?? "")
	}

	return args
}

/** Return the punctuation marks of an abstract tree, in reading order. */
const marksOf = (tree: AbstractTree): string[] =>
	tree.sentences.flatMap((sentence) =>
		sentence.nodes.flatMap((node) =>
			node.punctuationMark === undefined ? [] : [node.punctuationMark],
		),
	)

/** Format one side of the comparison with its punctuation marks. */
const describe = (label: string, text: string, marks: string[]): string =>
	marks.length === 0 ? `${label}: ${text}` : `${label}: ${text} (${marks.join(" ")})`

/** Run the command-line tool. */
const main = async (): Promise<void> => {
	const argv = process.argv.slice(2)
	const mode = parseMode(argv)
	const [leftText, rightText, ...extra] = sentenceArgs(argv)

	if (leftText === undefined || rightText === undefined || extra.length > 0) {
		console.error('usage: bun run compare-syntax "<sentence A>" "<sentence B>" [--mode coarse]')
		process.exitCode = 1

		return
	}

	const parser = createSyntaxParser(process.env)
	const leftParsed = await parser.parse(leftText)
	const rightParsed = await parser.parse(rightText)

	const leftTree = abstractTree(leftParsed, mode)
	const rightTree = abstractTree(rightParsed, mode)
	const leftVectors = encodeTree(leftTree).map((vector) => vector.values)
	const rightVectors = encodeTree(rightTree).map((vector) => vector.values)
	const score = multivectorSimilarity(leftVectors, rightVectors)
	const verdict = score >= IDENTICAL_SCORE ? "identical structure" : "different structure"

	console.log(describe("A", leftText, marksOf(leftTree)))
	console.log(describe("B", rightText, marksOf(rightTree)))
	console.log(`\nsyntax score (${mode}, ${DEFAULT_ENCODER_CONFIG.version}): ${score.toFixed(6)}`)
	console.log(`verdict: ${verdict}`)
}

if (import.meta.main) {
	await main()
}
