import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { createSyntaxParser, DEFAULT_MODEL_PATH, isModelPresent, modelPath } from "./config"
import { EmptyInputError } from "./parser"

describe("modelPath", () => {
	test("returns the default when the variable is absent or blank", () => {
		expect(modelPath()).toBe(DEFAULT_MODEL_PATH)
		expect(modelPath({ UDPIPE_MODEL_PATH: "  " })).toBe(DEFAULT_MODEL_PATH)
	})

	test("returns the configured path", () => {
		expect(modelPath({ UDPIPE_MODEL_PATH: "/opt/models/fr.udpipe" })).toBe("/opt/models/fr.udpipe")
	})
})

describe("isModelPresent", () => {
	test("returns false for a path that does not exist", () => {
		expect(isModelPresent({ UDPIPE_MODEL_PATH: "/nope/missing.udpipe" })).toBe(false)
	})

	test("returns true when the configured model exists", () => {
		const repoRoot = join(import.meta.dir, "..", "..", "..")
		const present = existsSync(join(repoRoot, DEFAULT_MODEL_PATH))

		expect(isModelPresent({}, repoRoot)).toBe(present)
	})
})

describe("createSyntaxParser", () => {
	test("returns a parser with a parse function", () => {
		const parser = createSyntaxParser()

		expect(typeof parser.parse).toBe("function")
	})

	test("raises EmptyInputError before it loads the model", async () => {
		const parser = createSyntaxParser({ UDPIPE_MODEL_PATH: "/nope/missing.udpipe" })

		await expect(parser.parse("  ")).rejects.toBeInstanceOf(EmptyInputError)
	})

	test("raises ParserUnavailableError for a missing model on first parse", async () => {
		const parser = createSyntaxParser({ UDPIPE_MODEL_PATH: "/nope/missing.udpipe" })

		await expect(parser.parse("Le garçon regarde le soleil.")).rejects.toThrow(/parser unavailable/)
	})
})
