import { describe, expect, test } from "bun:test"
import {
	ConcurrentWriteError,
	createIndexStateStore,
	type IndexStateDependencies,
	StaleGenerationError,
} from "./index-state"

/** Build in-memory dependencies with a deterministic clock and token source. */
const createMemoryDependencies = () => {
	const files = new Map<string, string>()
	let clock = 0
	let token = 0

	const dependencies: IndexStateDependencies = {
		readFile: async (path) => {
			const content = files.get(path)

			if (content === undefined) {
				const error = new Error("missing") as Error & { code: string }
				error.code = "ENOENT"

				throw error
			}

			return content
		},
		writeFile: async (path, data) => {
			files.set(path, data)
		},
		mkdir: async () => {},
		randomToken: () => {
			token += 1

			return `token-${token}`
		},
		now: () => {
			clock += 1

			return `2026-01-01T00:00:${String(clock).padStart(2, "0")}.000Z`
		},
	}

	return { dependencies, files }
}

describe("createIndexStateStore", () => {
	test("returns an empty state when the file is absent", async () => {
		const { dependencies } = createMemoryDependencies()
		const store = createIndexStateStore("state.json", dependencies)

		expect(await store.read()).toEqual({ version: 1 })
	})

	test("begins a rebuild in the rebuilding state", async () => {
		const { dependencies } = createMemoryDependencies()
		const store = createIndexStateStore("state.json", dependencies)
		const record = await store.beginRebuild()

		expect(record.status).toBe("rebuilding")
		expect(record.generation).toBe("token-1")
		expect(record.writer).toBe("token-2")
	})

	test("publishes a ready generation with the record count", async () => {
		const { dependencies } = createMemoryDependencies()
		const store = createIndexStateStore("state.json", dependencies)
		const begun = await store.beginRebuild()
		const ready = await store.publish({
			writer: begun.writer,
			expectedGeneration: begun.generation,
			recordCount: 42,
			configId: "cfg-1",
		})

		expect(ready.status).toBe("ready")
		expect(ready.recordCount).toBe(42)
		expect(ready.configId).toBe("cfg-1")
		expect(ready.readyAt).toBeDefined()
	})

	test("persists the state across store instances", async () => {
		const { dependencies } = createMemoryDependencies()
		const first = createIndexStateStore("state.json", dependencies)
		const begun = await first.beginRebuild()

		await first.publish({
			writer: begun.writer,
			expectedGeneration: begun.generation,
			recordCount: 7,
		})

		const second = createIndexStateStore("state.json", dependencies)
		const state = await second.read()

		expect(state.current?.generation).toBe(begun.generation)
		expect(state.current?.status).toBe("ready")
	})

	test("detects a concurrent writer that presents a different token", async () => {
		const { dependencies } = createMemoryDependencies()
		const store = createIndexStateStore("state.json", dependencies)
		const begun = await store.beginRebuild()

		await expect(
			store.publish({
				writer: "other-writer",
				expectedGeneration: begun.generation,
				recordCount: 1,
			}),
		).rejects.toBeInstanceOf(ConcurrentWriteError)
	})

	test("rejects a rebuild that presents a different live writer token", async () => {
		const { dependencies } = createMemoryDependencies()
		const store = createIndexStateStore("state.json", dependencies)
		const begun = await store.beginRebuild({ writer: "writer-a" })

		await expect(store.beginRebuild({ writer: "writer-b" })).rejects.toBeInstanceOf(
			ConcurrentWriteError,
		)
		await expect(store.beginRebuild({ writer: "writer-a" })).rejects.toBeInstanceOf(
			ConcurrentWriteError,
		)
		expect(begun.writer).toBe("writer-a")
	})

	test("detects a generation change before publication", async () => {
		const { dependencies } = createMemoryDependencies()
		const store = createIndexStateStore("state.json", dependencies)
		const begun = await store.beginRebuild()

		await expect(
			store.publish({
				writer: begun.writer,
				expectedGeneration: "different-generation",
				recordCount: 1,
			}),
		).rejects.toBeInstanceOf(StaleGenerationError)
	})

	test("recovers an interrupted writer on the next rebuild", async () => {
		const { dependencies } = createMemoryDependencies()
		const store = createIndexStateStore("state.json", dependencies)
		const abandoned = await store.beginRebuild()

		expect(abandoned.status).toBe("rebuilding")
		expect(await store.read()).toMatchObject({ current: { status: "rebuilding" } })

		const recovered = await store.beginRebuild()

		expect(recovered.generation).not.toBe(abandoned.generation)
		expect(recovered.status).toBe("rebuilding")
	})

	test("assertReady returns the record for the current ready generation", async () => {
		const { dependencies } = createMemoryDependencies()
		const store = createIndexStateStore("state.json", dependencies)
		const begun = await store.beginRebuild()

		await store.publish({
			writer: begun.writer,
			expectedGeneration: begun.generation,
			recordCount: 3,
		})

		const record = await store.assertReady(begun.generation)

		expect(record.generation).toBe(begun.generation)
		expect(record.status).toBe("ready")
	})

	test("assertReady rejects a changed generation", async () => {
		const { dependencies } = createMemoryDependencies()
		const store = createIndexStateStore("state.json", dependencies)

		await store.beginRebuild()

		await expect(store.assertReady("gone")).rejects.toBeInstanceOf(StaleGenerationError)
	})

	test("assertReady rejects a rebuild in progress", async () => {
		const { dependencies } = createMemoryDependencies()
		const store = createIndexStateStore("state.json", dependencies)
		const begun = await store.beginRebuild()

		await expect(store.assertReady(begun.generation)).rejects.toBeInstanceOf(ConcurrentWriteError)
	})

	test("recovers from a corrupt state file", async () => {
		const { dependencies, files } = createMemoryDependencies()

		files.set("state.json", "not json")

		const store = createIndexStateStore("state.json", dependencies)

		await expect(store.read()).rejects.toThrow()
	})
})
