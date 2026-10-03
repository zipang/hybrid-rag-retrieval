/**
 * French dependency parser adapter.
 *
 * The adapter wraps the selected parser (`udpipe-wasm` with the pinned
 * `french-gsd` model). It reads the full CoNLL-U output, because the npm wrapper
 * drops the `FEATS` column that the detailed mode needs.
 *
 * The adapter keeps the parser engine behind an injectable interface. Tests
 * inject a fake engine. The real engine loads the model once and reuses it.
 *
 * The adapter validates every parse before it returns:
 *
 * - every token has a nonempty form, word class, and dependency label;
 * - every governor index is inside the sentence;
 * - every sentence has at least one root;
 * - every token reaches a root without a cycle.
 *
 * A parse that fails validation raises {@link ParseValidationError}. A missing
 * model or an unavailable engine raises {@link ParserUnavailableError}.
 */

/** One token with its grammatical annotation, in the test data set order. */
export type ParsedToken = [
	form: string,
	lemma: string,
	upos: string,
	head: number,
	deprel: string,
	feats: string,
]

/** One parsed sentence: an ordered list of tokens. */
export type ParsedSentence = ParsedToken[]

/** One parsed text: one sentence or a forest of sentences. */
export type ParsedText = {
	/** Sentence trees, in reading order. */
	sentences: ParsedSentence[]
}

/** Engine that turns text into CoNLL-U. Injectable for tests. */
export type ParserEngine = {
	/** Parse text and return one CoNLL-U block per sentence. */
	parseToConllu: (text: string) => string
}

/** Loader that returns a ready engine, or raises when the model is absent. */
export type ParserEngineLoader = () => Promise<ParserEngine>

/** Dependencies of the parser adapter. */
export type ParserDependencies = {
	/** Load the parser engine. Reused across calls. */
	loadEngine: ParserEngineLoader
}

/** The parser facade that the rest of the project uses. */
export type Parser = {
	/** Parse one text into validated sentence trees. */
	parse: (text: string) => Promise<ParsedText>
}

/** Error raised when the model or engine is unavailable. */
export class ParserUnavailableError extends Error {
	/** Create the error with the cause message. */
	constructor(reason: string) {
		super(`parser unavailable: ${reason}`)
		this.name = "ParserUnavailableError"
	}
}

/** Error raised when a parse fails structural validation. */
export class ParseValidationError extends Error {
	/** Create the error with the failed rule. */
	constructor(reason: string) {
		super(`invalid parse: ${reason}`)
		this.name = "ParseValidationError"
	}
}

/** Error raised for blank or unusable input. */
export class EmptyInputError extends Error {
	/** Create the error. */
	constructor() {
		super("input text is blank")
		this.name = "EmptyInputError"
	}
}

/** Read one CoNLL-U line into a token, or `undefined` for a skipped line. */
const parseConlluLine = (line: string): ParsedToken | undefined => {
	const trimmed = line.trim()

	if (trimmed === "" || trimmed.startsWith("#")) {
		return undefined
	}

	const fields = trimmed.split("\t")

	if (fields.length < 8) {
		return undefined
	}

	const idField = fields[0] ?? ""

	// Skip multiword-token ranges ("1-2") and empty nodes ("3.1").
	if (idField.includes("-") || idField.includes(".")) {
		return undefined
	}

	const head = Number.parseInt(fields[6] ?? "", 10)

	if (!Number.isSafeInteger(head)) {
		return undefined
	}

	return [
		fields[1] ?? "",
		fields[2] ?? "",
		fields[3] ?? "",
		head,
		fields[7] ?? "",
		(fields[5] ?? "") === "_" ? "" : (fields[5] ?? ""),
	]
}

/**
 * Split a CoNLL-U string into sentences.
 *
 * A blank line ends one sentence. A comment-only block is skipped. The function
 * returns the sentence trees in reading order.
 */
export const parseConlluBlocks = (conllu: string): ParsedText => {
	const sentences: ParsedSentence[] = []
	let current: ParsedSentence = []

	for (const line of conllu.split("\n")) {
		if (line.trim() === "") {
			if (current.length > 0) {
				sentences.push(current)
				current = []
			}

			continue
		}

		const token = parseConlluLine(line)

		if (token !== undefined) {
			current.push(token)
		}
	}

	if (current.length > 0) {
		sentences.push(current)
	}

	return { sentences }
}

/** Validate one sentence and raise a {@link ParseValidationError} on failure. */
const validateSentence = (sentence: ParsedSentence, index: number): void => {
	if (sentence.length === 0) {
		throw new ParseValidationError(`sentence ${index} is empty`)
	}

	const size = sentence.length
	let roots = 0

	for (const token of sentence) {
		const [form, , upos, head, deprel] = token

		if (form === "") {
			throw new ParseValidationError(`sentence ${index} has a token with no form`)
		}

		if (upos === "") {
			throw new ParseValidationError(`sentence ${index} has a token with no word class`)
		}

		if (deprel === "") {
			throw new ParseValidationError(`sentence ${index} has a token with no dependency label`)
		}

		if (head < 0 || head > size) {
			throw new ParseValidationError(`sentence ${index} has head ${head} outside 0..${size}`)
		}

		if (head === 0) {
			roots += 1
		}
	}

	if (roots === 0) {
		throw new ParseValidationError(`sentence ${index} has no root`)
	}

	for (let start = 0; start < size; start += 1) {
		const seen = new Set<number>()
		let current = start + 1

		while (current !== 0) {
			if (seen.has(current)) {
				throw new ParseValidationError(`sentence ${index} has a cycle at token ${current}`)
			}

			seen.add(current)
			current = sentence[current - 1]?.[3] ?? 0
		}
	}
}

/** Validate every sentence of a parse. */
export const validateParse = (parse: ParsedText): void => {
	if (parse.sentences.length === 0) {
		throw new ParseValidationError("no sentence was produced")
	}

	for (const [index, sentence] of parse.sentences.entries()) {
		validateSentence(sentence, index)
	}
}

/**
 * Create a parser adapter over an injectable engine loader.
 *
 * The adapter loads the engine once on the first call and reuses it. The
 * specification requires one loaded model, not one model per query.
 */
export const createParser = (dependencies: ParserDependencies): Parser => {
	let engine: Promise<ParserEngine> | undefined

	const getEngine = (): Promise<ParserEngine> => {
		if (engine === undefined) {
			engine = dependencies.loadEngine().catch((error: unknown) => {
				engine = undefined

				throw new ParserUnavailableError(error instanceof Error ? error.message : String(error))
			})
		}

		return engine
	}

	const parse = async (text: string): Promise<ParsedText> => {
		if (text.trim() === "") {
			throw new EmptyInputError()
		}

		const loaded = await getEngine()
		const conllu = loaded.parseToConllu(text)

		if (conllu.startsWith("ERROR:")) {
			throw new ParseValidationError(conllu.slice("ERROR:".length).trim())
		}

		const parsed = parseConlluBlocks(conllu)

		validateParse(parsed)

		return parsed
	}

	return { parse }
}
