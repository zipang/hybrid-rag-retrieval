import type { Validator } from "tjs"
import type { DescribedRecordSchema } from "../models/schema"

/** Input required to parse one dataset with its record model. */
export type DatasetReader<T extends object> = {
	/** TJS validator that checks and coerces each record. */
	validator: Validator<T>
	/** JSON Schema with source field labels in each property's title. */
	schema: DescribedRecordSchema
	/** Values to add when an optional source field is absent. */
	defaults?: Partial<T>
}

/** One valid record or one rejected block from a dataset. */
export type DatasetReadEvent<T> =
	| { type: "record"; record: T }
	| { type: "rejected"; block: number; reason: string }

/** Counts for a completed dataset read. */
export type DatasetReadSummary = {
	acceptedCount: number
	rejectedCount: number
}

/** Results from reading an in-memory dataset. */
export type DatasetReadResult<T> = {
	events: DatasetReadEvent<T>[]
	summary: DatasetReadSummary
}

/** Results from reading a dataset file as a stream. */
export type DatasetStream<T> = {
	events: AsyncIterable<DatasetReadEvent<T>>
	summary: Promise<DatasetReadSummary>
}

/** Parser that accepts lines and emits a result when a block ends. */
type BlockParser<T> = {
	push: (line: string) => DatasetReadEvent<T> | null
	flush: () => DatasetReadEvent<T> | null
}

const BLOCK_SEPARATOR = "---"

/** Create a parser that validates one field block at a time. */
const createBlockParser = <T extends object>(reader: DatasetReader<T>): BlockParser<T> => {
	let lines: string[] = []
	let blockNumber = 0
	const propertyByLabel = new Map<string, string>()

	for (const property of Object.keys(reader.schema.properties)) {
		propertyByLabel.set(property, property)
	}

	for (const [property, fieldSchema] of Object.entries(reader.schema.properties)) {
		if (!propertyByLabel.has(fieldSchema.title)) {
			propertyByLabel.set(fieldSchema.title, property)
		}
	}

	/** Validate the lines in the current block and reset the parser state. */
	const parseBlock = (): DatasetReadEvent<T> | null => {
		if (lines.length === 0) {
			return null
		}

		blockNumber += 1
		const currentLines = lines
		lines = []
		const values: Record<string, unknown> = { ...reader.defaults }

		for (const [lineIndex, line] of currentLines.entries()) {
			const separator = line.indexOf(":")

			if (separator === -1) {
				return {
					type: "rejected",
					block: blockNumber,
					reason: `line ${lineIndex + 1} has no field separator ":"`,
				}
			}

			const label = line.slice(0, separator).trim()
			const property = propertyByLabel.get(label)

			if (property === undefined) {
				return {
					type: "rejected",
					block: blockNumber,
					reason: `line ${lineIndex + 1} has unknown field label "${label}"`,
				}
			}

			values[property] = line.slice(separator + 1).trim()
		}

		const result = reader.validator.validate(values)

		if (!result.valid) {
			let reason = ""

			for (const error of result.error) {
				const location = error.instancePath || "record"
				reason += `${reason === "" ? "" : "; "}${location}: ${error.message}`
			}

			return { type: "rejected", block: blockNumber, reason }
		}

		return { type: "record", record: result.value }
	}

	return {
		/** Add one line or emit the completed block at its separator. */
		push: (line) => {
			if (line === BLOCK_SEPARATOR) {
				return parseBlock()
			}

			if (line !== "") {
				lines.push(line)
			}

			return null
		},
		/** Validate a trailing block when the input has no final separator. */
		flush: parseBlock,
	}
}

/** Count valid records and rejected blocks in a sequence of read events. */
const summarizeEvents = <T>(events: readonly DatasetReadEvent<T>[]): DatasetReadSummary => {
	let acceptedCount = 0
	let rejectedCount = 0

	for (const event of events) {
		if (event.type === "record") {
			acceptedCount += 1
			continue
		}

		rejectedCount += 1
	}

	return { acceptedCount, rejectedCount }
}

/** Parse dataset text into validated records and rejected-block events. */
export const parseDataset = <T extends object>(
	text: string,
	reader: DatasetReader<T>,
): DatasetReadResult<T> => {
	const parser = createBlockParser(reader)
	const events: DatasetReadEvent<T>[] = []

	for (const rawLine of text.split("\n")) {
		const event = parser.push(rawLine.trim())

		if (event !== null) {
			events.push(event)
		}
	}

	const trailing = parser.flush()

	if (trailing !== null) {
		events.push(trailing)
	}

	return { events, summary: summarizeEvents(events) }
}

/** Stream validated records and a final summary from a dataset file. */
export const streamDataset = <T extends object>(
	filePath: string,
	reader: DatasetReader<T>,
): DatasetStream<T> => {
	let resolveSummary: (summary: DatasetReadSummary) => void = () => {}
	const summary = new Promise<DatasetReadSummary>((resolve) => {
		resolveSummary = resolve
	})
	const events: AsyncIterable<DatasetReadEvent<T>> = {
		/** Yield each parsed block event and resolve the final record counts. */
		async *[Symbol.asyncIterator]() {
			const decoder = new TextDecoder()
			const parser = createBlockParser(reader)
			let buffer = ""
			let acceptedCount = 0
			let rejectedCount = 0

			/** Update summary counts and return the event for the caller. */
			const recordEvent = (event: DatasetReadEvent<T> | null): DatasetReadEvent<T> | null => {
				if (event?.type === "record") {
					acceptedCount += 1
				}

				if (event?.type === "rejected") {
					rejectedCount += 1
				}

				return event
			}

			try {
				for await (const chunk of Bun.file(filePath).stream()) {
					buffer += decoder.decode(chunk, { stream: true })
					let newline = buffer.indexOf("\n")

					while (newline !== -1) {
						const event = recordEvent(parser.push(buffer.slice(0, newline).trim()))

						if (event !== null) {
							yield event
						}

						buffer = buffer.slice(newline + 1)
						newline = buffer.indexOf("\n")
					}
				}

				buffer += decoder.decode()
				const lastLine = buffer.trim()

				if (lastLine !== "") {
					const event = recordEvent(parser.push(lastLine))

					if (event !== null) {
						yield event
					}
				}

				const trailing = recordEvent(parser.flush())

				if (trailing !== null) {
					yield trailing
				}
			} finally {
				resolveSummary({ acceptedCount, rejectedCount })
			}
		},
	}

	return { events, summary }
}
