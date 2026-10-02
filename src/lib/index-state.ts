/**
 * Durable index generation state.
 *
 * An index generation is one version of corpus data and scoring configuration.
 * Readers bind a query to a generation, so a score from one generation never
 * mixes with a score from another. This module stores that state in a JSON file
 * and offers the operations that a writer and a reader need.
 *
 * The state distinguishes two status values:
 *
 * - `rebuilding`: a writer is replacing the generation. Readers must not treat
 *   the syntax index as ready.
 * - `ready`: a writer finished the generation and accounted for every record.
 *
 * A writer holds a unique writer token. A second writer that presents a
 * different token is a concurrent-write error. An interrupted writer leaves the
 * state in `rebuilding`. The next writer recovers it with a new publication.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

/** Status of one index generation. */
export type GenerationStatus = "rebuilding" | "ready"

/** One persisted index generation record. */
export type GenerationRecord = {
	/** Opaque generation identifier. Unique for each rebuild. */
	generation: string
	/** Publication status. */
	status: GenerationStatus
	/** Writer token that owns the rebuild. */
	writer: string
	/** ISO-8601 timestamp of the rebuild start. */
	startedAt: string
	/** ISO-8601 timestamp of the last state change. */
	updatedAt: string
	/** ISO-8601 timestamp of the successful publication, when ready. */
	readyAt?: string
	/** Encoding or scoring configuration identifier. */
	configId?: string
	/** Record count from the completed run. */
	recordCount?: number
}

/** State file contents. */
export type IndexState = {
	/** Schema version of the state file. */
	version: number
	/** The current generation, or `undefined` when the index is empty. */
	current?: GenerationRecord
}

/** Error raised when a writer holds a different token than the state. */
export class ConcurrentWriteError extends Error {
	/** The token that owns the rebuild. */
	readonly owner: string

	/** Create the error with the current owner token. */
	constructor(owner: string) {
		super(`index generation is owned by writer ${owner}`)
		this.name = "ConcurrentWriteError"
		this.owner = owner
	}
}

/** Error raised when a publication does not match the expected generation. */
export class StaleGenerationError extends Error {
	/** The generation that the caller approved. */
	readonly expected: string
	/** The generation that is current. */
	readonly actual: string

	/** Create the error with the expected and the actual generation. */
	constructor(expected: string, actual: string) {
		super(`generation changed from ${expected} to ${actual}`)
		this.name = "StaleGenerationError"
		this.expected = expected
		this.actual = actual
	}
}

/** Dependencies of the index state store. Tests inject a fake file layer. */
export type IndexStateDependencies = {
	/** Read a UTF-8 file, or throw when it does not exist. */
	readFile: (path: string) => Promise<string>
	/** Write a UTF-8 file atomically. */
	writeFile: (path: string, data: string) => Promise<void>
	/** Create a directory and its parents. */
	mkdir: (path: string) => Promise<void>
	/** Generate a unique token. */
	randomToken: () => string
	/** Current time as an ISO-8601 string. */
	now: () => string
}

/** One index generation store bound to a file path. */
export type IndexStateStore = {
	/** Read the state, or return an empty state when the file is absent. */
	read: () => Promise<IndexState>
	/** Begin a rebuild and claim the writer token. */
	beginRebuild: (options?: { configId?: string; writer?: string }) => Promise<GenerationRecord>
	/** Mark the generation ready, when the caller still owns it and expects it. */
	publish: (options: {
		writer: string
		expectedGeneration: string
		recordCount: number
		configId?: string
	}) => Promise<GenerationRecord>
	/** Confirm that a generation is still current and ready. */
	assertReady: (generation: string) => Promise<GenerationRecord>
}

/** Schema version of the state file. */
const STATE_VERSION = 1

/** The default dependencies use the real file system. */
const defaultDependencies = (): IndexStateDependencies => ({
	readFile: async (path) => readFile(path, "utf8"),
	writeFile: async (path, data) => {
		const temp = `${path}.${process.pid}.tmp`

		await writeFile(temp, data, "utf8")
		await rename(temp, path)
	},
	mkdir: async (path) => {
		await mkdir(path, { recursive: true })
	},
	randomToken: () => crypto.randomUUID(),
	now: () => new Date().toISOString(),
})

/** Parse a state file into an {@link IndexState}. */
const parseState = (raw: string): IndexState => {
	const parsed: unknown = JSON.parse(raw)

	if (typeof parsed !== "object" || parsed === null) {
		return { version: STATE_VERSION }
	}

	const candidate = parsed as { version?: unknown; current?: unknown }

	if (candidate.current === undefined) {
		return { version: typeof candidate.version === "number" ? candidate.version : STATE_VERSION }
	}

	return {
		version: typeof candidate.version === "number" ? candidate.version : STATE_VERSION,
		current: candidate.current as GenerationRecord,
	}
}

/**
 * Create an index state store over one file path.
 *
 * A read of a missing file returns an empty state. A write goes through a
 * temporary file and a rename, so a reader never sees a partial document.
 */
export const createIndexStateStore = (
	path: string,
	dependencies: IndexStateDependencies = defaultDependencies(),
): IndexStateStore => {
	const read = async (): Promise<IndexState> => {
		try {
			return parseState(await dependencies.readFile(path))
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") {
				return { version: STATE_VERSION }
			}

			throw error
		}
	}

	const write = async (state: IndexState): Promise<void> => {
		await dependencies.mkdir(dirname(path))
		await dependencies.writeFile(path, `${JSON.stringify(state, null, 2)}\n`)
	}

	const beginRebuild = async (
		options: { configId?: string; writer?: string } = {},
	): Promise<GenerationRecord> => {
		const state = await read()
		const current = state.current

		if (current !== undefined && current.status === "rebuilding" && options.writer !== undefined) {
			throw new ConcurrentWriteError(current.writer)
		}

		const now = dependencies.now()
		const record: GenerationRecord = {
			generation: dependencies.randomToken(),
			status: "rebuilding",
			writer: options.writer ?? dependencies.randomToken(),
			startedAt: now,
			updatedAt: now,
		}

		if (options.configId !== undefined) {
			record.configId = options.configId
		}

		await write({ version: STATE_VERSION, current: record })

		return record
	}

	const publish = async (options: {
		writer: string
		expectedGeneration: string
		recordCount: number
		configId?: string
	}): Promise<GenerationRecord> => {
		const state = await read()
		const current = state.current

		if (current === undefined) {
			throw new StaleGenerationError(options.expectedGeneration, "")
		}

		if (current.writer !== options.writer) {
			throw new ConcurrentWriteError(current.writer)
		}

		if (current.generation !== options.expectedGeneration) {
			throw new StaleGenerationError(options.expectedGeneration, current.generation)
		}

		const now = dependencies.now()
		const record: GenerationRecord = {
			...current,
			status: "ready",
			updatedAt: now,
			readyAt: now,
			recordCount: options.recordCount,
		}

		if (options.configId !== undefined) {
			record.configId = options.configId
		}

		await write({ version: STATE_VERSION, current: record })

		return record
	}

	const assertReady = async (generation: string): Promise<GenerationRecord> => {
		const state = await read()
		const current = state.current

		if (current === undefined || current.generation !== generation) {
			throw new StaleGenerationError(generation, current?.generation ?? "")
		}

		if (current.status !== "ready") {
			throw new ConcurrentWriteError(current.writer)
		}

		return current
	}

	return { read, beginRebuild, publish, assertReady }
}

/** Default state file path for the slogan index. */
export const DEFAULT_INDEX_STATE_PATH = "data/index-state.json"
