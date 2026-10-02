import { describe, expect, test } from "bun:test"
import {
	AbstractionError,
	abstractSentence,
	abstractTree,
	canonicalFeatures,
	DETAILED_FEATURE_ALLOWLIST,
} from "./abstraction"
import type { ParsedSentence, ParsedText } from "./parser"

/** Build a token helper for the tests. */
const token = (
	form: string,
	lemma: string,
	upos: string,
	head: number,
	deprel: string,
	feats = "",
): ParsedSentence[number] => [form, lemma, upos, head, deprel, feats]

/** One simple sentence: the boy looks at the sun. */
const SIMPLE: ParsedSentence = [
	token("Le", "le", "DET", 2, "det", "Definite=Def|Gender=Masc|Number=Sing|PronType=Art"),
	token("garçon", "garçon", "NOUN", 3, "nsubj", "Gender=Masc|Number=Sing"),
	token("regarde", "regarder", "VERB", 0, "root", "Mood=Ind|Tense=Pres"),
	token("le", "le", "DET", 5, "det", "Definite=Def|Gender=Masc"),
	token("soleil", "soleil", "NOUN", 3, "obj", "Gender=Masc|Number=Sing"),
]

describe("canonicalFeatures", () => {
	test("removes every feature for the coarse profile", () => {
		expect(canonicalFeatures("Definite=Def|Gender=Masc", "coarse")).toBe("")
	})

	test("keeps only the allowlist for the detailed profile", () => {
		// PronType is not in the allowlist, so the detailed profile drops it.
		expect(canonicalFeatures("Definite=Def|Gender=Masc|PronType=Art", "detailed")).toBe(
			"Definite=Def|Gender=Masc",
		)
	})

	test("sorts the kept entries into a canonical order", () => {
		expect(canonicalFeatures("Number=Sing|Definite=Def|Gender=Masc", "detailed")).toBe(
			"Definite=Def|Gender=Masc|Number=Sing",
		)
	})

	test("returns an empty string when no allowlisted feature is present", () => {
		expect(canonicalFeatures("PronType=Art", "detailed")).toBe("")
		expect(canonicalFeatures("", "detailed")).toBe("")
	})

	test("declares the allowlist from the specification", () => {
		expect([...DETAILED_FEATURE_ALLOWLIST]).toEqual([
			"Definite",
			"Gender",
			"Mood",
			"Number",
			"Person",
			"Tense",
			"VerbForm",
			"Voice",
		])
	})
})

describe("abstractSentence", () => {
	test("keeps the structure and drops the vocabulary and the features", () => {
		const abstract = abstractSentence(SIMPLE, "coarse")

		expect(abstract.nodes).toEqual([
			{ upos: "DET", deprel: "det", head: 2, feats: "" },
			{ upos: "NOUN", deprel: "nsubj", head: 3, feats: "" },
			{ upos: "VERB", deprel: "root", head: 0, feats: "" },
			{ upos: "DET", deprel: "det", head: 5, feats: "" },
			{ upos: "NOUN", deprel: "obj", head: 3, feats: "" },
		])
		expect(abstract.root).toBe(3)
	})

	test("keeps the full label for the detailed profile", () => {
		const sentence: ParsedSentence = [
			token("La", "le", "DET", 2, "det", "Definite=Def"),
			token("lettre", "lettre", "NOUN", 4, "nsubj:pass", "Gender=Fem"),
			token("a", "avoir", "AUX", 4, "aux:pass", "Tense=Pres"),
			token("été", "être", "AUX", 4, "aux:pass", "Tense=Past"),
			token("lue", "lire", "VERB", 0, "root", "VerbForm=Part"),
		]
		const abstract = abstractSentence(sentence, "detailed")

		expect(abstract.nodes[1]?.deprel).toBe("nsubj:pass")
		expect(abstract.nodes[1]?.feats).toBe("Gender=Fem")
	})

	test("uses the base label for the coarse profile", () => {
		const sentence: ParsedSentence = [
			token("La", "le", "DET", 2, "det"),
			token("lettre", "lettre", "NOUN", 3, "nsubj:pass"),
			token("lue", "lire", "VERB", 0, "root"),
		]
		const abstract = abstractSentence(sentence, "coarse")

		expect(abstract.nodes[1]?.deprel).toBe("nsubj")
	})

	test("removes punctuation nodes and remaps the heads", () => {
		const sentence: ParsedSentence = [
			token("Le", "le", "DET", 2, "det"),
			token("chat", "chat", "NOUN", 3, "nsubj"),
			token("dort", "dormir", "VERB", 0, "root"),
			token(".", ".", "PUNCT", 3, "punct"),
		]
		const abstract = abstractSentence(sentence, "coarse")

		expect(abstract.nodes.map((node) => node.upos)).toEqual(["DET", "NOUN", "VERB"])
		expect(abstract.root).toBe(3)
	})

	test("raises when a head points at a removed punctuation node", () => {
		const sentence: ParsedSentence = [
			token("Le", "le", "DET", 2, "det"),
			token("chat", "chat", "NOUN", 4, "nsubj"),
			token("dort", "dormir", "VERB", 0, "root"),
			token(".", ".", "PUNCT", 2, "punct"),
		]

		expect(() => abstractSentence(sentence, "coarse")).toThrow(AbstractionError)
	})

	test("raises when a sentence has only punctuation", () => {
		const sentence: ParsedSentence = [token(".", ".", "PUNCT", 0, "root")]

		expect(() => abstractSentence(sentence, "coarse")).toThrow(AbstractionError)
	})
})

describe("abstractTree", () => {
	test("keeps the sentence boundaries", () => {
		const parsed: ParsedText = {
			sentences: [
				[token("Le", "le", "DET", 2, "det"), token("chat", "chat", "NOUN", 0, "root")],
				[token("Le", "le", "DET", 2, "det"), token("chien", "chien", "NOUN", 0, "root")],
			],
		}
		const tree = abstractTree(parsed, "coarse")

		expect(tree.profile).toBe("coarse")
		expect(tree.sentences).toHaveLength(2)
	})

	test("raises when the text has no sentence", () => {
		expect(() => abstractTree({ sentences: [] }, "coarse")).toThrow(AbstractionError)
	})
})
