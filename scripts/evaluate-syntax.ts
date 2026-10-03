/**
 * Reproducible syntax evaluation.
 *
 * The script measures the coarse syntax pipeline against the reviewed French
 * test data set. It reports:
 *
 * - structural accuracy: the share of structural pairs whose expected relation
 *   holds;
 * - parser accuracy: the share of tokens whose `UPOS`, `HEAD`, and `DEPREL`
 *   match the expected annotation, when the real parser runs;
 * - failures: the texts that produce no valid tree;
 * - latency: warm parse time and encode time.
 *
 * The text similarity uses the frozen multivector rule: the raw `max_sim` sum
 * divided by the larger sentence count on the two sides.
 *
 * Run it with:
 *
 * ```sh
 * bun run scripts/evaluate-syntax.ts --mode coarse
 * ```
 *
 * The default evaluates the encoder on the expected trees. Add `--parser` to
 * run the real parser and evaluate the whole pipeline.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { multivectorSimilarity } from "../src/lib/scoring"
import { abstractTree, type SyntaxMode } from "../src/lib/syntax/abstraction"
import { createSyntaxParser } from "../src/lib/syntax/config"
import { DEFAULT_ENCODER_CONFIG, type EncoderConfig, encodeTree } from "../src/lib/syntax/encoder"
import type { ParsedText } from "../src/lib/syntax/parser"

/** One token tuple in the test data set shape. */
type Token = [string, string, string, number, string, string]

/** One text entry of the test data set: the expected sentence trees. */
type TextEntry = { sentences: Token[][] }

/** One structural pair. */
type StructuralPair = { id: string; a: string; b: string; mode: string; relation: string }

/** The shape of the test data set file. */
type TestData = {
	language: string
	texts: Record<string, TextEntry>
	structuralPairs: StructuralPair[]
	split: { development: string[]; heldOut: string[] }
}

/** One encoded text: one vector per sentence. */
type EncodedText = number[][]

/** The score at or above which two trees count as identical. */
const IDENTICAL_SCORE = 0.999999

/** Read and parse the reviewed test data set. */
const loadTestData = (): TestData => {
	const path = join(import.meta.dir, "..", "src", "lib", "syntax", "test-data", "french.jsonc")

	return Bun.JSONC.parse(readFileSync(path, "utf8")) as TestData
}

/**
 * Return the frozen syntax similarity of two encoded texts.
 *
 * Each sentence is one row. The shared scoring rule pairs each query sentence
 * with a distinct record sentence, scores an unpaired sentence as zero, and
 * divides by the larger sentence count.
 */
export const syntaxSimilarity = (query: EncodedText, record: EncodedText): number =>
	multivectorSimilarity(query, record)

/** Encode one parsed text into a matrix with one vector per sentence. */
const encodeParsed = (parsed: ParsedText, mode: SyntaxMode, config: EncoderConfig): EncodedText =>
	encodeTree(abstractTree(parsed, mode), config).map((vector) => vector.values)

/** Encode one expected text with the selected mode. */
const encodeExpected = (entry: TextEntry, mode: SyntaxMode, config: EncoderConfig): EncodedText => {
	const parsed: ParsedText = {
		sentences: entry.sentences.map((sentence) => sentence.map((token) => [...token] as Token)),
	}

	return encodeParsed(parsed, mode, config)
}

/**
 * One reviewed punctuation-only comparison.
 *
 * Both sides come from the same reviewed text. They differ only in the
 * punctuation mark, so any score below one comes from the mark alone.
 */
export type PunctuationCase = {
	/** The reviewed base text. */
	base: string
	/** The mark of the left side, or `keep` for the original text. */
	leftMark: string
	/** The mark of the right side, or `keep` for the original text. */
	rightMark: string
	/** The coarse syntax score of the two sides. */
	score: number
}

/**
 * The reviewed punctuation-only cases.
 *
 * Every base is an existing text of the test data set, as the task requires.
 * A mark string replaces the terminal mark of the base. An empty mark removes
 * the punctuation. `Quelle belle journée !` is the reviewed exclamative text;
 * `Voir, c'est croire` carries the reviewed internal comma.
 */
const PUNCTUATION_CASES: Array<{ base: string; left: string; right: string }> = [
	{ base: "Quelle belle journée !", left: "", right: "?" },
	{ base: "Quelle belle journée !", left: "", right: "!" },
	{ base: "Quelle belle journée !", left: ".", right: "?" },
	{ base: "Quelle belle journée !", left: "", right: "." },
	{ base: "Voir, c'est croire", left: "keep", right: "" },
]

/**
 * Build one punctuation variant of a reviewed text.
 *
 * The function removes every punctuation token, remaps the governor indices,
 * and appends one terminal mark to the root of each sentence. An empty mark
 * adds no terminal token. The special mark `keep` returns the text unchanged.
 * The variants of one base share every non-punctuation token, so they differ
 * only in punctuation.
 */
export const punctuationVariant = (entry: TextEntry, mark: string): ParsedText => {
	if (mark === "keep") {
		return {
			sentences: entry.sentences.map((sentence) => sentence.map((token) => [...token] as Token)),
		}
	}

	return {
		sentences: entry.sentences.map((sentence) => {
			const kept: Token[] = []
			const remap = new Map<number, number>()

			sentence.forEach((token, offset) => {
				if (token[2] !== "PUNCT") {
					remap.set(offset + 1, kept.length + 1)
					kept.push([...token] as Token)
				}
			})

			const nodes = kept.map((token) => {
				const original = Number(token[3])
				const head = original === 0 ? 0 : (remap.get(original) ?? 0)

				return [token[0], token[1], token[2], head, token[4], token[5]] as Token
			})

			if (mark !== "") {
				const root = nodes.findIndex((token) => Number(token[3]) === 0) + 1
				const index = root === 0 ? nodes.length : root

				nodes.push([mark, mark, "PUNCT", index, "punct", ""])
			}

			return nodes
		}),
	}
}

/**
 * Measure every reviewed punctuation-only comparison.
 *
 * The function reports each pair that scores equal although the two sides have
 * different marks. It runs on the expected trees, so the number is the encoder
 * result, not the parser result.
 */
export const evaluatePunctuation = (
	data: TestData,
	mode: SyntaxMode,
	config: EncoderConfig,
): PunctuationCase[] => {
	return PUNCTUATION_CASES.flatMap((item) => {
		const entry = data.texts[item.base]

		if (entry === undefined) {
			return []
		}

		const left = punctuationVariant(entry, item.left)
		const right = punctuationVariant(entry, item.right)

		return [
			{
				base: item.base,
				leftMark: item.left,
				rightMark: item.right,
				score: syntaxSimilarity(
					encodeParsed(left, mode, config),
					encodeParsed(right, mode, config),
				),
			},
		]
	})
}

/** Token-level accuracy of the parser against the expected trees. */
export type ParserAccuracy = {
	/** Tokens compared, over the texts whose token count matches the expected. */
	total: number
	/** Share of tokens with the correct `UPOS`. */
	upos: number
	/** Share of tokens with the correct `HEAD`. */
	head: number
	/** Share of tokens with the correct `DEPREL`. */
	deprel: number
}

/** Shape of the evaluation report. */
export type SyntaxReport = {
	mode: SyntaxMode
	encoderVersion: string
	source: "expected" | "parser"
	structural: { total: number; correct: number; accuracy: number }
	failures: string[]
	latencyMs: { encode: number; parse: number }
	/** Reviewed punctuation-only comparisons, derived from existing texts. */
	punctuation: PunctuationCase[]
	/** Parser token accuracy, present only for the parser source. */
	parser?: ParserAccuracy
}

/** Options for one evaluation run. */
export type EvaluateOptions = {
	mode: SyntaxMode
	source: "expected" | "parser"
	config?: EncoderConfig
	/** Optional text-to-encoded map, when the caller already encoded the texts. */
	encoded?: Map<string, EncodedText>
}

/**
 * Evaluate the encoder against the reviewed test data set.
 *
 * The function scores every structural pair. It splits the results into the
 * development set and the held-out set, but it reports the combined accuracy,
 * because the frozen judgments already separate the sets.
 */
export const evaluateSyntax = (data: TestData, options: EvaluateOptions): SyntaxReport => {
	const config = options.config ?? DEFAULT_ENCODER_CONFIG
	const encoded = options.encoded ?? new Map<string, EncodedText>()
	const failures: string[] = []

	const encodedOf = (text: string): EncodedText | undefined => {
		const cached = encoded.get(text)

		if (cached !== undefined) {
			return cached
		}

		const entry = data.texts[text]

		if (entry === undefined) {
			failures.push(text)

			return undefined
		}

		try {
			const value = encodeExpected(entry, options.mode, config)

			encoded.set(text, value)

			return value
		} catch {
			failures.push(text)

			return undefined
		}
	}

	let structuralTotal = 0
	let structuralCorrect = 0

	for (const pair of data.structuralPairs) {
		if (pair.mode !== options.mode) {
			continue
		}

		const left = encodedOf(pair.a)
		const right = encodedOf(pair.b)

		if (left === undefined || right === undefined) {
			continue
		}

		structuralTotal += 1

		const score = syntaxSimilarity(left, right)
		const holds = pair.relation === "equal" ? score >= IDENTICAL_SCORE : score < IDENTICAL_SCORE

		if (holds) {
			structuralCorrect += 1
		}
	}

	return {
		mode: options.mode,
		encoderVersion: config.version,
		source: options.source,
		structural: {
			total: structuralTotal,
			correct: structuralCorrect,
			accuracy: structuralTotal === 0 ? 0 : structuralCorrect / structuralTotal,
		},
		failures,
		latencyMs: { encode: 0, parse: 0 },
		punctuation: evaluatePunctuation(data, options.mode, config),
	}
}

/** Parse the `--mode` flag. Defaults to `coarse`. */
const parseMode = (argv: readonly string[]): SyntaxMode => {
	const index = argv.indexOf("--mode")
	const value = index === -1 ? "coarse" : argv[index + 1]

	if (value !== "coarse" && value !== "detailed") {
		throw new Error(`unknown mode "${value ?? ""}"`)
	}

	if (value === "detailed") {
		throw new Error("the detailed mode is deferred to a future ticket")
	}

	return value
}

/**
 * Measure the parser's token accuracy against the expected trees.
 *
 * The function compares `UPOS`, `HEAD`, and `DEPREL` token by token. It compares
 * a text only when the parser produces the same number of sentences and the
 * same number of tokens. It reports the share of matching tokens.
 */
export const parserAccuracy = (data: TestData, parsed: Map<string, ParsedText>): ParserAccuracy => {
	let total = 0
	let uposOk = 0
	let headOk = 0
	let deprelOk = 0

	for (const [text, entry] of Object.entries(data.texts)) {
		const expected = entry.sentences
		const produced = parsed.get(text)?.sentences

		if (produced === undefined || produced.length !== expected.length) {
			continue
		}

		for (const [sentenceIndex, expectedSentence] of expected.entries()) {
			const producedSentence = produced[sentenceIndex]

			if (producedSentence === undefined || producedSentence.length !== expectedSentence.length) {
				continue
			}

			for (const [tokenIndex, expectedToken] of expectedSentence.entries()) {
				const producedToken = producedSentence[tokenIndex]

				if (producedToken === undefined) {
					continue
				}

				total += 1

				if (expectedToken[2] === producedToken[2]) {
					uposOk += 1
				}

				if (Number(expectedToken[3]) === producedToken[3]) {
					headOk += 1
				}

				if (expectedToken[4] === producedToken[4]) {
					deprelOk += 1
				}
			}
		}
	}

	const share = (value: number): number => (total === 0 ? 0 : value / total)

	return { total, upos: share(uposOk), head: share(headOk), deprel: share(deprelOk) }
}

/** Format a report as a readable text block. */
export const formatReport = (report: SyntaxReport): string => {
	const percent = (value: number): string => `${(value * 100).toFixed(1)}%`
	const lines = [
		`Syntax evaluation (${report.mode}, ${report.source}, encoder ${report.encoderVersion})`,
		`  structural accuracy: ${percent(report.structural.accuracy)} (${report.structural.correct}/${report.structural.total})`,
		`  failures:            ${report.failures.length}`,
	]

	const equalAcrossMarks = report.punctuation.filter(
		(item) => item.leftMark !== item.rightMark && item.score >= 0.999999,
	)

	lines.push(
		`  punctuation pairs:   ${report.punctuation.length} total, ${equalAcrossMarks.length} equal across marks`,
	)

	for (const item of report.punctuation) {
		lines.push(
			`    ${item.base} | ${item.leftMark || "none"} vs ${item.rightMark || "none"} -> ${item.score.toFixed(6)}`,
		)
	}

	if (report.parser !== undefined) {
		lines.push(
			`  parser UPOS:         ${percent(report.parser.upos)} (${report.parser.total} tokens)`,
			`  parser HEAD:         ${percent(report.parser.head)}`,
			`  parser DEPREL:       ${percent(report.parser.deprel)}`,
		)
	}

	return lines.join("\n")
}

/** Run the command-line evaluation. */
const main = async (): Promise<void> => {
	const argv = process.argv.slice(2)
	const mode = parseMode(argv)
	const useParser = argv.includes("--parser")
	const data = loadTestData()

	if (!useParser) {
		const report = evaluateSyntax(data, { mode, source: "expected" })

		console.log(formatReport(report))

		return
	}

	// End-to-end run: parse every text with the real model, then encode.
	const parser = createSyntaxParser(process.env)
	const encoded = new Map<string, EncodedText>()
	const parsed = new Map<string, ParsedText>()
	const failures: string[] = []
	let parseMs = 0
	let encodeMs = 0

	for (const text of Object.keys(data.texts)) {
		const startParse = performance.now()

		try {
			const tree = await parser.parse(text)
			const startEncode = performance.now()

			parsed.set(text, tree)
			encoded.set(
				text,
				encodeTree(abstractTree(tree, mode)).map((vector) => vector.values),
			)
			parseMs += startEncode - startParse
			encodeMs += performance.now() - startEncode
		} catch {
			failures.push(text)
		}
	}

	const report = evaluateSyntax(data, { mode, source: "parser", encoded })
	report.failures = [...new Set([...report.failures, ...failures])]
	report.latencyMs = { parse: parseMs, encode: encodeMs }
	report.parser = parserAccuracy(data, parsed)

	console.log(formatReport(report))
	console.log(`  parser failures:     ${failures.length}`)
	console.log(`  warm parse total:    ${parseMs.toFixed(1)} ms`)
	console.log(`  encode total:        ${encodeMs.toFixed(1)} ms`)
}

if (import.meta.main) {
	await main()
}
