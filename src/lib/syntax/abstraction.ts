/**
 * Tree abstraction for the syntax encoder.
 *
 * The abstraction removes everything the encoder must not see: the words, the
 * lemmas, and the punctuation. It keeps the grammatical structure: the word
 * classes, the dependency connections, the relative word order, and the
 * dependency labels.
 *
 * Two profiles select how much detail the abstract tree keeps:
 *
 * - `coarse`: keep the structure only. Remove every grammatical feature.
 * - `detailed`: keep the structure and an allowlist of grammatical features.
 *
 * This ticket implements and validates `coarse`. The `detailed` branch is
 * deferred to a future ticket. The functions already take a profile parameter,
 * so the future branch needs no interface change. See the plan, "Deferred
 * Work".
 */

import type { ParsedSentence, ParsedText } from "./parser"

/** The grammatical specificity profile. */
export type SyntaxProfile = "coarse" | "detailed"

/** The grammatical features that the `detailed` profile keeps. */
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
	 * The `coarse` profile keeps the base label, before the first colon. The
	 * `detailed` profile will keep the full label.
	 */
	deprel: string
	/** 1-based index of the governor, or `0` for the root. */
	head: number
	/** Canonical grammatical features, empty for the `coarse` profile. */
	feats: string
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
	/** The profile that produced this tree. */
	profile: SyntaxProfile
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
 * Word classes that mean the same thing for the coarse profile.
 *
 * `NOUN` and `PROPN` are both nominal. The choice between a common noun and a
 * proper noun is a lexical property of the word, not a structural one. The
 * coarse profile compares structure only, so it maps a proper noun onto the
 * common-noun class. The detailed profile keeps the raw class.
 */
export const COARSE_UPOS_EQUIVALENCE: Record<string, string> = {
	PROPN: "NOUN",
}

/**
 * Return the word class for one profile.
 *
 * The coarse profile maps an equivalent class onto its canonical class, for
 * example `PROPN` onto `NOUN`. The detailed profile keeps the raw class.
 */
export const canonicalUpos = (upos: string, profile: SyntaxProfile): string => {
	if (profile === "coarse") {
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
 * The `coarse` profile keeps nothing, so it returns an empty string.
 */
export const canonicalFeatures = (feats: string, profile: SyntaxProfile): string => {
	if (profile === "coarse" || feats === "") {
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
 * The function removes punctuation nodes and remaps the head indices to the
 * remaining nodes. It resolves the profile label rule and the profile feature
 * rule. It raises {@link AbstractionError} when the sentence has no root.
 */
export const abstractSentence = (
	sentence: ParsedSentence,
	profile: SyntaxProfile,
): AbstractSentence => {
	// Keep the tokens that carry grammar, with their original 1-based index.
	const kept: Array<{ index: number; token: ParsedSentence[number] }> = []

	for (const [offset, token] of sentence.entries()) {
		if (!isPunctuation(token[2])) {
			kept.push({ index: offset + 1, token })
		}
	}

	if (kept.length === 0) {
		throw new AbstractionError("sentence has no non-punctuation token")
	}

	// Map an original index to the new 1-based position.
	const remap = new Map<number, number>()

	for (const [offset, entry] of kept.entries()) {
		remap.set(entry.index, offset + 1)
	}

	const nodes: AbstractNode[] = []
	let root = 0

	for (const entry of kept) {
		const [, , upos, head, deprel, feats] = entry.token
		const newNode = remap.get(entry.index) ?? 0
		const newHead = head === 0 ? 0 : (remap.get(head) ?? 0)

		if (head !== 0 && newHead === 0) {
			throw new AbstractionError(`token ${entry.index} depends on removed or missing head ${head}`)
		}

		if (newHead === 0) {
			root = newNode
		}

		nodes.push({
			upos: canonicalUpos(upos, profile),
			deprel: profile === "coarse" ? baseLabel(deprel) : deprel,
			head: newHead,
			feats: canonicalFeatures(feats, profile),
		})
	}

	return { nodes, root }
}

/**
 * Abstract a parsed text into a forest.
 *
 * The function keeps the sentence boundaries, because the specification
 * requires a grammatical forest for a multi-sentence text.
 */
export const abstractTree = (parsed: ParsedText, profile: SyntaxProfile): AbstractTree => {
	if (parsed.sentences.length === 0) {
		throw new AbstractionError("text has no sentence")
	}

	return {
		profile,
		sentences: parsed.sentences.map((sentence) => abstractSentence(sentence, profile)),
	}
}
