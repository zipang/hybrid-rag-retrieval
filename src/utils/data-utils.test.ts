import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { schema } from "tjs"
import { datasetConfigurations } from "../config/datasets"
import type { DescribedRecordSchema } from "../models/schema"
import { parseDataset, streamDataset } from "./data-utils"

const OVERLAPPING_FIELD_LABELS_SCHEMA = {
	description: "A record with a key that matches another field's source title.",
	type: "object",
	properties: {
		id: {
			title: "Identifier",
			type: "string",
			description: "Record identifier: Stable key for this record.",
		},
		sourceId: {
			title: "id",
			type: "string",
			description: "Filter field: Source identifier from the upstream system.",
		},
	},
	required: ["id", "sourceId"],
	additionalProperties: false,
} as const satisfies DescribedRecordSchema

const OVERLAPPING_FIELD_LABELS_READER = {
	schema: OVERLAPPING_FIELD_LABELS_SCHEMA,
	validator: schema(OVERLAPPING_FIELD_LABELS_SCHEMA),
}

const SLOGAN_CORPUS = [
	"Id: 1",
	"Année: 2004",
	"Marque: Danone",
	"Slogan: Un peu de sucre, beaucoup d'idées",
	"---",
	"Id: 2",
	"Année: unknown",
	"Marque: Marque B",
	"Slogan: Slogan invalide",
	"---",
	"Id: 3",
	"Année: 1980",
	"Marque: Marque C",
	"Campagne: Campagne C",
	"Slogan: Slogan final",
].join("\n")

const CITATION_CORPUS = [
	"id: 1",
	"author: William Shakespeare",
	"work: Hamlet",
	"year: 1603",
	"lang: en",
	"trad:",
	"quote: To be, or not to be: that is the question",
	"---",
].join("\n")

describe("parseDataset", () => {
	test("parses typed records and counts invalid blocks", () => {
		const result = parseDataset(SLOGAN_CORPUS, datasetConfigurations.slogans)

		expect(result.events).toEqual([
			{
				type: "record",
				record: {
					id: 1,
					annee: 2004,
					marque: "Danone",
					campagne: "",
					slogan: "Un peu de sucre, beaucoup d'idées",
				},
			},
			expect.objectContaining({
				type: "rejected",
				block: 2,
				reason: expect.stringContaining("annee"),
			}),
			{
				type: "record",
				record: {
					id: 3,
					annee: 1980,
					marque: "Marque C",
					campagne: "Campagne C",
					slogan: "Slogan final",
				},
			},
		])
		expect(result.summary).toEqual({ acceptedCount: 2, rejectedCount: 1 })
	})

	test("matches source labels from schema titles without requiring line order", () => {
		const text = ["Slogan: Slogan text", "Marque: Brand", "Id: 7", "Année: 2005", "---"].join("\n")
		const result = parseDataset(text, datasetConfigurations.slogans)

		expect(result.events).toEqual([
			{
				type: "record",
				record: {
					id: 7,
					annee: 2005,
					marque: "Brand",
					campagne: "",
					slogan: "Slogan text",
				},
			},
		])
	})

	test("matches JSON Schema property keys as canonical field labels", () => {
		const text = ["id: 8", "annee: 2006", "marque: Brand", "slogan: A slogan", "---"].join("\n")
		const result = parseDataset(text, datasetConfigurations.slogans)

		expect(result.events).toEqual([
			{
				type: "record",
				record: {
					id: 8,
					annee: 2006,
					marque: "Brand",
					campagne: "",
					slogan: "A slogan",
				},
			},
		])
	})

	test("prefers a property key over another field's matching title", () => {
		const result = parseDataset(
			"id: primary\nsourceId: upstream\n---",
			OVERLAPPING_FIELD_LABELS_READER,
		)

		expect(result.events).toEqual([
			{ type: "record", record: { id: "primary", sourceId: "upstream" } },
		])
	})

	test("maps citation fields and keeps a blank translation", () => {
		const result = parseDataset(CITATION_CORPUS, datasetConfigurations.citations)

		expect(result.events).toEqual([
			{
				type: "record",
				record: {
					id: 1,
					author: "William Shakespeare",
					work: "Hamlet",
					year: 1603,
					lang: "en",
					trad: "",
					quote: "To be, or not to be: that is the question",
				},
			},
		])
		expect(result.summary).toEqual({ acceptedCount: 1, rejectedCount: 0 })
	})

	test("rejects unknown field labels", () => {
		const result = parseDataset(
			`${CITATION_CORPUS.replace("---", "unknown: value\n---")}`,
			datasetConfigurations.citations,
		)

		expect(result.events[0]).toMatchObject({
			type: "rejected",
			block: 1,
			reason: expect.stringContaining('unknown field label "unknown"'),
		})
		expect(result.summary.rejectedCount).toBe(1)
	})

	test("reports the line that has no field separator", () => {
		const result = parseDataset("id: 2\nmalformed line\n---", datasetConfigurations.citations)

		expect(result.events[0]).toMatchObject({
			type: "rejected",
			block: 1,
			reason: 'line 2 has no field separator ":"',
		})
	})

	test("rejects a block that omits a required field", () => {
		const result = parseDataset(
			"id: 2\nauthor: William Shakespeare\nwork: Hamlet\nyear: 1603\nlang: en\ntrad:\n---",
			datasetConfigurations.citations,
		)

		expect(result.events).toMatchObject([
			{ type: "rejected", block: 1, reason: expect.stringContaining("quote") },
		])
		expect(result.summary).toEqual({ acceptedCount: 0, rejectedCount: 1 })
	})
})

describe("streamDataset", () => {
	test("returns the same events and summary as the in-memory reader", async () => {
		const temporaryRoot = join(import.meta.dir, "../..", ".tmp")
		await mkdir(temporaryRoot, { recursive: true })
		const directory = await mkdtemp(join(temporaryRoot, "dataset-reader-"))
		const filePath = join(directory, "corpus.txt")
		await Bun.write(filePath, SLOGAN_CORPUS)

		try {
			const streamed = streamDataset(filePath, datasetConfigurations.slogans)
			const events = []

			for await (const event of streamed.events) {
				events.push(event)
			}

			expect(events).toEqual(parseDataset(SLOGAN_CORPUS, datasetConfigurations.slogans).events)
			expect(await streamed.summary).toEqual({ acceptedCount: 2, rejectedCount: 1 })

			const citationPath = join(directory, "citations.txt")
			await Bun.write(citationPath, CITATION_CORPUS)
			const citationStream = streamDataset(citationPath, datasetConfigurations.citations)
			const citationEvents = []

			for await (const event of citationStream.events) {
				citationEvents.push(event)
			}

			expect(citationEvents).toEqual(
				parseDataset(CITATION_CORPUS, datasetConfigurations.citations).events,
			)
			expect(await citationStream.summary).toEqual({ acceptedCount: 1, rejectedCount: 0 })
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	})
})
