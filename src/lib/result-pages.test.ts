import { describe, expect, test } from "bun:test"
import {
	CursorExpiredError,
	CursorMismatchError,
	createResultPageStore,
	type ResultPageDependencies,
	type SnapshotBinding,
	SnapshotCapacityError,
} from "./result-pages"
import type { ScoredRecord } from "./scoring"

/** A fixed query binding for the tests. */
const binding: SnapshotBinding = {
	text: "sucre",
	weights: { syntax: 0, semantic: 1, keyword: 0 },
	minScore: 0,
	generation: "gen-1",
}

/** Build deterministic dependencies with a controllable clock and id source. */
const createDeps = () => {
	let clock = 0
	let id = 0
	const dependencies: ResultPageDependencies = {
		randomId: () => {
			id += 1

			return `snap-${id}`
		},
		now: () => clock,
	}

	return {
		dependencies,
		advance: (ms: number) => {
			clock += ms
		},
	}
}

/** Build a descending ranking of `count` records. */
const ranking = (count: number): ScoredRecord[] =>
	Array.from({ length: count }, (_, index) => ({ id: index + 1, score: (count - index) / count }))

describe("createResultPageStore", () => {
	test("returns one page when no page size is given", () => {
		const { dependencies } = createDeps()
		const store = createResultPageStore(dependencies)
		const snapshot = store.create(ranking(5), binding)

		const page = store.read({ snapshotId: snapshot.id, binding })

		expect(page.records.map((record) => record.id)).toEqual([1, 2, 3, 4, 5])
		expect(page.nextCursor).toBeUndefined()
	})

	test("paginates every qualifying record exactly once", () => {
		const { dependencies } = createDeps()
		const store = createResultPageStore(dependencies)
		const snapshot = store.create(ranking(7), binding)
		const seen: Array<number | string> = []
		let cursor: string | undefined

		for (;;) {
			const page: ReturnType<typeof store.read> = store.read({
				snapshotId: snapshot.id,
				binding,
				pageSize: 3,
				...(cursor === undefined ? {} : { cursor }),
			})

			seen.push(...page.records.map((record) => record.id))

			if (page.nextCursor === undefined) {
				break
			}

			cursor = page.nextCursor
		}

		expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7])
	})

	test("keeps the same order across different page sizes", () => {
		const { dependencies } = createDeps()
		const store = createResultPageStore(dependencies)
		const records = ranking(6)
		const snapshot = store.create(records, binding)

		const sizeTwo = [...store.read({ snapshotId: snapshot.id, binding, pageSize: 2 }).records]
		const sizeFive = store.read({ snapshotId: snapshot.id, binding, pageSize: 5 }).records

		expect(sizeFive.map((record) => record.id)).toEqual([1, 2, 3, 4, 5])
		expect(sizeTwo.map((record) => record.id)).toEqual([1, 2])
	})

	test("rejects a cursor from a different query binding", () => {
		const { dependencies } = createDeps()
		const store = createResultPageStore(dependencies)
		const snapshot = store.create(ranking(4), binding)
		const first = store.read({ snapshotId: snapshot.id, binding, pageSize: 2 })

		expect(() =>
			store.read({
				binding: { ...binding, text: "autre" },
				cursor: first.nextCursor ?? "",
			}),
		).toThrow(CursorMismatchError)
	})

	test("rejects a cursor after the generation changes", () => {
		const { dependencies } = createDeps()
		const store = createResultPageStore(dependencies)
		const snapshot = store.create(ranking(4), binding)
		const first = store.read({ snapshotId: snapshot.id, binding, pageSize: 2 })

		expect(() =>
			store.read({
				binding: { ...binding, generation: "gen-2" },
				cursor: first.nextCursor ?? "",
			}),
		).toThrow(CursorMismatchError)
	})

	test("rejects a malformed cursor", () => {
		const { dependencies } = createDeps()
		const store = createResultPageStore(dependencies)

		store.create(ranking(4), binding)

		expect(() => store.read({ binding, cursor: "not-a-cursor" })).toThrow(CursorMismatchError)
	})

	test("rejects a cursor after the snapshot expires", () => {
		const { dependencies, advance } = createDeps()
		const store = createResultPageStore(dependencies, { ttlMs: 1000 })
		const snapshot = store.create(ranking(4), binding)
		const first = store.read({ snapshotId: snapshot.id, binding, pageSize: 2 })

		advance(2000)

		expect(() => store.read({ binding, cursor: first.nextCursor ?? "" })).toThrow(
			CursorExpiredError,
		)
	})

	test("rejects an unknown snapshot identifier", () => {
		const { dependencies } = createDeps()
		const store = createResultPageStore(dependencies)

		expect(() => store.read({ snapshotId: "missing", binding })).toThrow(CursorExpiredError)
	})

	test("evicts the oldest snapshot when the bound is reached", () => {
		const { dependencies, advance } = createDeps()
		const store = createResultPageStore(dependencies, { maxSnapshots: 2, refreshOnAccess: false })
		const first = store.create(ranking(2), binding)

		advance(1)

		store.create(ranking(2), binding)

		advance(1)

		store.create(ranking(2), binding)

		expect(store.size()).toBe(2)
		expect(() => store.read({ snapshotId: first.id, binding })).toThrow(CursorExpiredError)
	})

	test("raises a capacity error when no snapshot is evictable", () => {
		const { dependencies } = createDeps()
		const store = createResultPageStore(dependencies, { maxSnapshots: 0 })

		expect(() => store.create(ranking(2), binding)).toThrow(SnapshotCapacityError)
	})

	test("prunes expired snapshots before counting", () => {
		const { dependencies, advance } = createDeps()
		const store = createResultPageStore(dependencies, { ttlMs: 500 })

		store.create(ranking(2), binding)

		advance(1000)

		expect(store.size()).toBe(0)
	})

	test("refreshes the lifetime on access when configured", () => {
		const { dependencies, advance } = createDeps()
		const store = createResultPageStore(dependencies, { ttlMs: 500, refreshOnAccess: true })
		const snapshot = store.create(ranking(2), binding)

		advance(400)

		store.read({ snapshotId: snapshot.id, binding })

		advance(400)

		expect(store.size()).toBe(1)
	})
})
