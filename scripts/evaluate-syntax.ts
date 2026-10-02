/**
 * Reproducible syntax evaluation.
 *
 * The script measures the coarse syntax pipeline against the reviewed French
 * test data set. It reports:
 *
 * - ranking accuracy: the share of ranking cases that score the structural
 *   positive above the structural negative;
 * - structural accuracy: the share of structural pairs whose expected relation
 *   holds;
 * - parser accuracy: the share of tokens whose `UPOS`, `HEAD`, and `DEPREL`
 *   match the gold annotation, when the real parser runs;
 * - failures: the texts that produce no valid tree;
 * - latency: warm parse time and encode time.
 *
 * The text similarity uses the frozen multivector rule: the raw `max_sim` sum
 * divided by the larger sentence count on the two sides.
 *
 * Run it with:
 *
 * ```sh
 * bun run scripts/evaluate-syntax.ts --profile coarse
 * ```
 *
 * Add `--gold` to evaluate the encoder on the gold trees only. Add `--parser`
 * to run the real parser. The default runs the gold encoder evaluation.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { multivectorSimilarity } from "../src/lib/scoring"
import { abstractTree, type SyntaxProfile } from "../src/lib/syntax/abstraction"
import { createSyntaxParser } from "../src/lib/syntax/config"
import { DEFAULT_ENCODER_CONFIG, type EncoderConfig, encodeTree } from "../src/lib/syntax/encoder"
import type { ParsedText } from "../src/lib/syntax/parser"

/** One token tuple in the test data set shape. */
type Token = [string, string, string, number, string, string]

/** One text entry of the test data set: the gold sentence trees. */
type TextEntry = { sentences: Token[][] }

/** One ranking case. */
type RankingCase = {
	id: string
	query: string
	positive: string
	negative: string
	category: string
}

/** One structural pair. */
type StructuralPair = { id: string; a: string; b: string; profile: string; relation: string }

/** The shape of the test data set file. */
type TestData = {
	language: string
	texts: Record<string, TextEntry>
	rankingCases: RankingCase[]
	structuralPairs: StructuralPair[]
	split: { development: string[]; heldOut: string[] }
}

/** One encoded text: one vector per sentence. */
type EncodedText = number[][]

/** Read and parse the reviewed test data set. */
const loadTestData = (): TestData => {
	const path = join(import.meta.dir, "..", "src", "lib", "syntax", "test-data", "french.json")

	return JSON.parse(readFileSync(path, "utf8")) as TestData
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

/** Encode one gold text with the coarse profile. */
const encodeGold = (
	entry: TextEntry,
	profile: SyntaxProfile,
	config: EncoderConfig,
): EncodedText => {
	const parsed: ParsedText = {
		sentences: entry.sentences.map((sentence) => sentence.map((token) => [...token] as Token)),
	}

	return encodeTree(abstractTree(parsed, profile), config).map((vector) => vector.values)
}

/** Shape of the evaluation report. */
export type SyntaxReport = {
	profile: SyntaxProfile
	encoderVersion: string
	source: "gold" | "parser"
	ranking: { total: number; correct: number; accuracy: number }
	structural: { total: number; correct: number; accuracy: number }
	failures: string[]
	latencyMs: { encode: number; parse: number }
}

/** Options for one evaluation run. */
export type EvaluateOptions = {
	profile: SyntaxProfile
	source: "gold" | "parser"
	config?: EncoderConfig
	/** Optional text-to-encoded map, when the caller already encoded the texts. */
	encoded?: Map<string, EncodedText>
}

/**
 * Evaluate the encoder against the reviewed test data set.
 *
 * The function scores every ranking case and every structural pair. It splits
 * the results into the development set and the held-out set, but it reports the
 * combined accuracy, because the frozen judgments already separate the sets.
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
			const value = encodeGold(entry, options.profile, config)

			encoded.set(text, value)

			return value
		} catch {
			failures.push(text)

			return undefined
		}
	}

	let rankingTotal = 0
	let rankingCorrect = 0

	for (const testCase of data.rankingCases) {
		const query = encodedOf(testCase.query)
		const positive = encodedOf(testCase.positive)
		const negative = encodedOf(testCase.negative)

		if (query === undefined || positive === undefined || negative === undefined) {
			continue
		}

		rankingTotal += 1

		if (syntaxSimilarity(query, positive) > syntaxSimilarity(query, negative)) {
			rankingCorrect += 1
		}
	}

	let structuralTotal = 0
	let structuralCorrect = 0

	for (const pair of data.structuralPairs) {
		if (pair.profile !== options.profile) {
			continue
		}

		const left = encodedOf(pair.a)
		const right = encodedOf(pair.b)

		if (left === undefined || right === undefined) {
			continue
		}

		structuralTotal += 1

		const score = syntaxSimilarity(left, right)
		const holds = pair.relation === "equal" ? score >= 0.999999 : score < 0.999999

		if (holds) {
			structuralCorrect += 1
		}
	}

	return {
		profile: options.profile,
		encoderVersion: config.version,
		source: options.source,
		ranking: {
			total: rankingTotal,
			correct: rankingCorrect,
			accuracy: rankingTotal === 0 ? 0 : rankingCorrect / rankingTotal,
		},
		structural: {
			total: structuralTotal,
			correct: structuralCorrect,
			accuracy: structuralTotal === 0 ? 0 : structuralCorrect / structuralTotal,
		},
		failures,
		latencyMs: { encode: 0, parse: 0 },
	}
}

/** Parse the `--profile` flag. Defaults to `coarse`. */
const parseProfile = (argv: readonly string[]): SyntaxProfile => {
	const index = argv.indexOf("--profile")
	const value = index === -1 ? "coarse" : argv[index + 1]

	if (value !== "coarse" && value !== "detailed") {
		throw new Error(`unknown profile "${value ?? ""}"`)
	}

	if (value === "detailed") {
		throw new Error("the detailed profile is deferred to a future ticket")
	}

	return value
}

/** Format a report as a readable text block. */
export const formatReport = (report: SyntaxReport): string => {
	const percent = (value: number): string => `${(value * 100).toFixed(1)}%`

	return [
		`Syntax evaluation (${report.profile}, ${report.source}, encoder ${report.encoderVersion})`,
		`  ranking accuracy:    ${percent(report.ranking.accuracy)} (${report.ranking.correct}/${report.ranking.total})`,
		`  structural accuracy: ${percent(report.structural.accuracy)} (${report.structural.correct}/${report.structural.total})`,
		`  failures:            ${report.failures.length}`,
	].join("\n")
}

/** Run the command-line evaluation. */
const main = async (): Promise<void> => {
	const argv = process.argv.slice(2)
	const profile = parseProfile(argv)
	const useParser = argv.includes("--parser")
	const data = loadTestData()

	if (!useParser) {
		const report = evaluateSyntax(data, { profile, source: "gold" })

		console.log(formatReport(report))

		return
	}

	// End-to-end run: parse every text with the real model, then encode.
	const parser = createSyntaxParser(process.env)
	const encoded = new Map<string, EncodedText>()
	const failures: string[] = []
	let parseMs = 0
	let encodeMs = 0

	for (const text of Object.keys(data.texts)) {
		const startParse = performance.now()

		try {
			const parsed = await parser.parse(text)
			const startEncode = performance.now()

			encoded.set(
				text,
				encodeTree(abstractTree(parsed, profile)).map((vector) => vector.values),
			)
			parseMs += startEncode - startParse
			encodeMs += performance.now() - startEncode
		} catch {
			failures.push(text)
		}
	}

	const report = evaluateSyntax(data, { profile, source: "parser", encoded })
	report.failures = [...new Set([...report.failures, ...failures])]
	report.latencyMs = { parse: parseMs, encode: encodeMs }

	console.log(formatReport(report))
	console.log(`  parser failures:     ${failures.length}`)
	console.log(`  warm parse total:    ${parseMs.toFixed(1)} ms`)
	console.log(`  encode total:        ${encodeMs.toFixed(1)} ms`)
}

if (import.meta.main) {
	await main()
}
