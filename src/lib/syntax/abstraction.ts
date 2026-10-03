/**
 * Tree abstraction for the syntax encoder.
 *
 * The abstraction removes everything the encoder must not see: the words and
 * the content-word lemmas. It keeps the grammatical structure: the word
 * classes, the dependency connections, the relative word order, the dependency
 * labels, and the punctuation marks.
 *
 * Two modes select how much detail the abstract tree keeps:
 *
 * - `coarse`: keep the structure only. Remove every grammatical feature.
 * - `detailed`: keep the structure and an allowlist of grammatical features.
 *
 * This ticket implements and validates `coarse`. The `detailed` branch is
 * deferred to a future ticket. The functions already take a mode parameter,
 * so the future branch needs no interface change. See the plan, "Deferred
 * Work".
 */

import type { ParsedSentence, ParsedText } from "./parser"

/** The grammatical specificity mode. */
export type SyntaxMode = "coarse" | "detailed"

/** The grammatical features that the `detailed` mode keeps. */
export const DETAILED_FEATURE_ALLOWLIST = [
	"Definite",
	"Gender",
	"Mood",
	"Number",
	"Person",
	"Tense",
	"VerbForm",
	"Voice",
] as const

/** One abstract node: a word stripped of its vocabulary. */
export type AbstractNode = {
	/** Universal word class, for example `NOUN`. */
	upos: string
	/**
	 * Dependency label.
	 *
	 * The `coarse` mode keeps the base label, before the first colon. The
	 * `detailed` mode will keep the full label.
	 */
	deprel: string
	/** 1-based index of the governor, or `0` for the root. */
	head: number
	/** Canonical grammatical features, empty for the `coarse` mode. */
	feats: string
	/**
	 * The mark of a punctuation node, for example `?`, `!`, or `,`.
	 *
	 * The value is the token's `LEMMA`, present only for a punctuation node.
	 * Every other node leaves the field absent, so content-word vocabulary
	 * never enters. A mark is a closed symbol set, not open vocabulary.
	 */
	punctuationMark?: string
}

/** One abstract sentence: nodes in reading order, plus the root index. */
export type AbstractSentence = {
	/** Nodes in reading order. The position is the 1-based token index. */
	nodes: AbstractNode[]
	/** 1-based index of the root, or `0` when the sentence has no root. */
	root: number
}

/** One abstract text: a forest of abstract sentences. */
export type AbstractTree = {
	/** The mode that produced this tree. */
	mode: SyntaxMode
	/** Abstract sentences, in reading order. */
	sentences: AbstractSentence[]
}

/** Error raised when a sentence has no root after abstraction. */
export class AbstractionError extends Error {
	/** Create the error with the reason. */
	constructor(reason: string) {
		super(`abstraction failed: ${reason}`)
		this.name = "AbstractionError"
	}
}

/** Return whether a token is punctuation. */
const isPunctuation = (upos: string): boolean => upos === "PUNCT"

/** Keep the base label before the first colon. */
const baseLabel = (deprel: string): string => deprel.split(":")[0] ?? deprel

/**
 * Word classes that mean the same thing for the coarse mode.
 *
 * `NOUN` and `PROPN` are both nominal. The choice between a common noun and a
 * proper noun is a lexical property of the word, not a structural one. The
 * coarse mode compares structure only, so it maps a proper noun onto the
 * common-noun class. The detailed mode keeps the raw class.
 */
export const COARSE_UPOS_EQUIVALENCE: Record<string, string> = {
	PROPN: "NOUN",
}

/**
 * Return the word class for one mode.
 *
 * The coarse mode maps an equivalent class onto its canonical class, for
 * example `PROPN` onto `NOUN`. The detailed mode keeps the raw class.
 */
export const canonicalUpos = (upos: string, mode: SyntaxMode): string => {
	if (mode === "coarse") {
		return COARSE_UPOS_EQUIVALENCE[upos] ?? upos
	}

	return upos
}

/**
 * Filter and canonicalize a feature string.
 *
 * The function splits the raw `FEATS` value on `|`, keeps the allowlisted keys,
 * sorts the entries, and rejoins them. The canonical order makes two equal
 * feature sets produce the same string.
 *
 * The `coarse` mode keeps nothing, so it returns an empty string.
 */
export const canonicalFeatures = (feats: string, mode: SyntaxMode): string => {
	if (mode === "coarse" || feats === "") {
		return ""
	}

	const keep = new Set<string>(DETAILED_FEATURE_ALLOWLIST)

	return feats
		.split("|")
		.filter((entry) => keep.has(entry.split("=")[0] ?? ""))
		.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
		.join("|")
}

/**
 * Abstract one parsed sentence.
 *
 * The function keeps every node, including the punctuation nodes, in reading
 * order and with the original 1-based indices, so the parser's governor stays
 * valid. It resolves the mode label rule and the mode feature rule.
 *
 * A punctuation node carries its mark, read from the token's `LEMMA`, in the
 * {@link AbstractNode.punctuationMark} field. Every other node leaves the
 * field absent, so content-word vocabulary never enters the encoder.
 *
 * The function raises {@link AbstractionError} when the sentence is empty or
 * has no root.
 */
export const abstractSentence = (sentence: ParsedSentence, mode: SyntaxMode): AbstractSentence => {
	if (sentence.length === 0) {
		throw new AbstractionError("sentence has no token")
	}

	const nodes: AbstractNode[] = []
	let root = 0

	sentence.forEach((token, offset) => {
		const [, lemma, upos, head, deprel, feats] = token
		const index = offset + 1

		if (head === 0) {
			root = index
		}

		const node: AbstractNode = {
			upos: canonicalUpos(upos, mode),
			deprel: mode === "coarse" ? baseLabel(deprel) : deprel,
			head,
			feats: canonicalFeatures(feats, mode),
		}

		if (isPunctuation(upos)) {
			node.punctuationMark = lemma
		}

		nodes.push(node)
	})

	if (root === 0) {
		throw new AbstractionError("sentence has no root")
	}

	return { nodes, root }
}

/**
 * Abstract a parsed text into a forest.
 *
 * The function keeps the sentence boundaries, because the specification
 * requires a grammatical forest for a multi-sentence text.
 */
export const abstractTree = (parsed: ParsedText, mode: SyntaxMode): AbstractTree => {
	if (parsed.sentences.length === 0) {
		throw new AbstractionError("text has no sentence")
	}

	return {
		mode,
		sentences: parsed.sentences.map((sentence) => abstractSentence(sentence, mode)),
	}
}
