import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import {
	createParser,
	EmptyInputError,
	type ParserEngine,
	ParserUnavailableError,
	ParseValidationError,
} from "./parser"
import { createUdpipEngineLoader } from "./udpipe-engine"

/** One valid one-sentence CoNLL-U block with features. */
const ONE_SENTENCE = [
	"# sent_id = 1",
	"# text = Le garçon regarde le soleil.",
	"1\tLe\tle\tDET\t_\tDefinite=Def|Gender=Masc|Number=Sing\t2\tdet\t_\t_",
	"2\tgarçon\tgarçon\tNOUN\t_\tGender=Masc|Number=Sing\t3\tnsubj\t_\t_",
	"3\tregarde\tregarder\tVERB\t_\tMood=Ind|Tense=Pres\t0\troot\t_\t_",
	"4\tle\tle\tDET\t_\tDefinite=Def|Gender=Masc\t5\tdet\t_\t_",
	"5\tsoleil\tsoleil\tNOUN\t_\tGender=Masc|Number=Sing\t3\tobj\t_\t_",
].join("\n")

/** A two-sentence CoNLL-U string. */
const TWO_SENTENCES = `${ONE_SENTENCE}\n\n# sent_id = 2\n# text = Un chat mange.\n1\tUn\tun\tDET\t_\t_\t2\tdet\t_\t_\n2\tchat\tchat\tNOUN\t_\tNumber=Sing\t3\tnsubj\t_\t_\n3\tmange\tmanger\tVERB\t_\t_\t0\troot\t_\t_\n`

/** Build a parser over a fixed CoNLL-U string. */
const parserWith = (conllu: string) =>
	createParser({ loadEngine: async () => ({ parseToConllu: () => conllu }) })

describe("createParser", () => {
	test("parses a sentence into the token tuple order", async () => {
		const parser = parserWith(ONE_SENTENCE)
		const parsed = await parser.parse("Le garçon regarde le soleil.")

		expect(parsed.sentences).toHaveLength(1)
		expect(parsed.sentences[0]).toEqual([
			["Le", "le", "DET", 2, "det", "Definite=Def|Gender=Masc|Number=Sing"],
			["garçon", "garçon", "NOUN", 3, "nsubj", "Gender=Masc|Number=Sing"],
			["regarde", "regarder", "VERB", 0, "root", "Mood=Ind|Tense=Pres"],
			["le", "le", "DET", 5, "det", "Definite=Def|Gender=Masc"],
			["soleil", "soleil", "NOUN", 3, "obj", "Gender=Masc|Number=Sing"],
		])
	})

	test("keeps sentence boundaries for a forest", async () => {
		const parser = parserWith(TWO_SENTENCES)
		const parsed = await parser.parse("Deux phrases.")

		expect(parsed.sentences).toHaveLength(2)
		expect(parsed.sentences[0]?.[0]?.[0]).toBe("Le")
		expect(parsed.sentences[1]?.[0]?.[0]).toBe("Un")
	})

	test("maps an absent feature column to an empty string", async () => {
		const conllu =
			"1\tToujours\ttoujours\tADV\t_\t_\t2\tadvmod\t_\t_\n2\tvite\tvite\tADV\t_\t_\t0\troot\t_\t_"
		const parser = parserWith(conllu)
		const parsed = await parser.parse("Toujours vite")

		expect(parsed.sentences[0]?.[0]?.[5]).toBe("")
	})

	test("skips multiword-token ranges and empty nodes", async () => {
		const conllu = [
			"1\tau\tau\tADP\t_\t_\t3\tcase\t_\t_",
			"1-2\tau\t_\t_\t_\t_\t_\t_\t_\t_",
			"2\tle\tle\tDET\t_\t_\t3\tdet\t_\t_",
			"3\tchat\tchat\tNOUN\t_\t_\t0\troot\t_\t_",
			"3.1\t_\t_\t_\t_\t_\t_\t_\t_\t_",
		].join("\n")
		const parser = parserWith(conllu)
		const parsed = await parser.parse("au chat")

		expect(parsed.sentences[0]?.map((token) => token[0])).toEqual(["au", "le", "chat"])
	})

	test("raises EmptyInputError for a blank text", async () => {
		const parser = parserWith(ONE_SENTENCE)

		await expect(parser.parse("   ")).rejects.toBeInstanceOf(EmptyInputError)
	})

	test("loads the engine once across calls", async () => {
		let loads = 0
		const engine: ParserEngine = { parseToConllu: () => ONE_SENTENCE }
		const parser = createParser({
			loadEngine: async () => {
				loads += 1

				return engine
			},
		})

		await parser.parse("premier")
		await parser.parse("deuxième")

		expect(loads).toBe(1)
	})

	test("wraps an engine load failure as ParserUnavailableError", async () => {
		const parser = createParser({
			loadEngine: async () => {
				throw new Error("model absent")
			},
		})

		await expect(parser.parse("texte")).rejects.toBeInstanceOf(ParserUnavailableError)
	})

	test("retries the load after a failure", async () => {
		let attempts = 0
		const parser = createParser({
			loadEngine: async () => {
				attempts += 1

				if (attempts === 1) {
					throw new Error("transient")
				}

				return { parseToConllu: () => ONE_SENTENCE }
			},
		})

		await expect(parser.parse("texte")).rejects.toBeInstanceOf(ParserUnavailableError)
		await expect(parser.parse("texte")).resolves.toBeDefined()
		expect(attempts).toBe(2)
	})

	test("raises ParseValidationError on an engine error string", async () => {
		const parser = parserWith("ERROR: empty input")

		await expect(parser.parse("x")).rejects.toBeInstanceOf(ParseValidationError)
	})

	test("raises ParseValidationError when no sentence appears", async () => {
		const parser = parserWith("# only a comment")

		await expect(parser.parse("x")).rejects.toBeInstanceOf(ParseValidationError)
	})

	test("raises ParseValidationError on a head outside the sentence", async () => {
		const conllu =
			"1\tchat\tchat\tNOUN\t_\t_\t9\tnsubj\t_\t_\n2\tdort\tdormir\tVERB\t_\t_\t0\troot\t_\t_"
		const parser = parserWith(conllu)

		await expect(parser.parse("chat dort")).rejects.toBeInstanceOf(ParseValidationError)
	})

	test("raises ParseValidationError on a sentence with no root", async () => {
		const conllu =
			"1\tchat\tchat\tNOUN\t_\t_\t2\tnsubj\t_\t_\n2\tdort\tdormir\tVERB\t_\t_\t1\troot\t_\t_"
		const parser = parserWith(conllu)

		await expect(parser.parse("chat dort")).rejects.toBeInstanceOf(ParseValidationError)
	})

	test("raises ParseValidationError on a cycle", async () => {
		const conllu =
			"1\ta\ta\tNOUN\t_\t_\t2\tnsubj\t_\t_\n2\tb\tb\tVERB\t_\t_\t3\tx\t_\t_\n3\tc\tc\tVERB\t_\t_\t2\ty\t_\t_"
		const parser = parserWith(conllu)

		await expect(parser.parse("abc")).rejects.toBeInstanceOf(ParseValidationError)
	})

	test("raises ParseValidationError on a token with no word class", async () => {
		const conllu = "1\tchat\tchat\t\t_\t_\t0\troot\t_\t_"
		const parser = parserWith(conllu)

		await expect(parser.parse("chat")).rejects.toBeInstanceOf(ParseValidationError)
	})
})

/** Path to the pinned model, overridable through the environment. */
const MODEL_PATH =
	process.env.UDPIPE_MODEL_PATH ??
	join(import.meta.dir, "..", "..", "..", "models", "french-gsd-ud-2.5-191206.udpipe")

const realSuite = existsSync(MODEL_PATH) ? describe : describe.skip

realSuite("createParser with the pinned French model", () => {
	const parser = createParser({
		loadEngine: createUdpipEngineLoader({ modelPath: MODEL_PATH }),
	})

	test("parses a French sentence with head, label, class, and features", async () => {
		const parsed = await parser.parse("Le garçon regarde le soleil.")
		const tokens = parsed.sentences[0] ?? []
		const byForm = (form: string) => tokens.find((token) => token[0] === form)

		expect(tokens.map((token) => token[0])).toEqual([
			"Le",
			"garçon",
			"regarde",
			"le",
			"soleil",
			".",
		])
		expect(byForm("regarde")?.[2]).toBe("VERB")
		expect(byForm("regarde")?.[3]).toBe(0)
		expect(byForm("garçon")?.[4]).toBe("nsubj")
		expect(byForm("le")?.[5]).toContain("Definite=")
	})

	test("parses two sentences as one forest", async () => {
		const parsed = await parser.parse("Un chat mange une souris. Le chien dort.")

		expect(parsed.sentences.length).toBe(2)
	})

	test("parses a hand-written test data text", async () => {
		const parsed = await parser.parse("Quelle belle journée !")

		expect(parsed.sentences).toHaveLength(1)
		expect(parsed.sentences[0]?.length).toBeGreaterThan(0)
	})
})
