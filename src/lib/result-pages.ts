/**
 * Stable result pagination over one scoring snapshot.
 *
 * One ranked query produces a snapshot: the complete ordered list of
 * qualifying records and their scores. A cursor points into that snapshot. The
 * snapshot does not change while the caller follows the cursors, so every
 * qualifying identifier appears exactly once and a page never depends on the
 * batch size or the page size.
 *
 * The cursor binds to the query and the index generation. A cursor from a
 * different query, a different generation, or an expired snapshot is rejected
 * instead of silently continuing.
 *
 * The store is bounded in two ways. It keeps at most `maxSnapshots` snapshots,
 * and it drops a snapshot after `ttlMs`. Bounds keep memory finite; they never
 * change which records qualify.
 */

import type { FullIndexWeights, IndexWeights } from "./retrieval-contract"
import type { ScoredRecord } from "./scoring"
import { SCORE_TOLERANCE } from "./scoring"

/** Error raised when a cursor does not match the current query. */
export class CursorMismatchError extends Error {
	/** Create the error. */
	constructor() {
		super("cursor does not match the current query, weights, threshold, or generation")
		this.name = "CursorMismatchError"
	}
}

/** Error raised when a cursor points to an expired or unknown snapshot. */
export class CursorExpiredError extends Error {
	/** Create the error. */
	constructor() {
		super("cursor snapshot has expired or is unknown")
		this.name = "CursorExpiredError"
	}
}

/** Error raised when the store cannot hold a new snapshot within its bound. */
export class SnapshotCapacityError extends Error {
	/** Create the error with the configured bound. */
	constructor(maxSnapshots: number) {
		super(`result snapshot store is full (max ${maxSnapshots} snapshots, none evictable)`)
		this.name = "SnapshotCapacityError"
		this.maxSnapshots = maxSnapshots
	}

	/** The configured snapshot bound. */
	readonly maxSnapshots: number
}

/** One ordered scoring snapshot. */
export type ResultSnapshot = {
	/** Opaque snapshot identifier. */
	id: string
	/** Ordered qualifying records, by combined score descending. */
	records: ScoredRecord[]
	/** Generation of the corpus and the scoring configuration. */
	generation: string
	/** Creation time in milliseconds since the epoch. */
	createdAt: number
	/** Last access time in milliseconds since the epoch. */
	lastAccessAt: number
}

/** Query fields that a cursor binds to. */
export type SnapshotBinding = {
	/** Query text. */
	text: string
	/** Validated weights. */
	weights: FullIndexWeights
	/** Minimum combined score. */
	minScore: number
	/** Payload filter bounds. */
	filters?: { yearFrom?: number; yearTo?: number }
	/** Index generation. */
	generation: string
}

/** One page read from a snapshot. */
export type ResultPage = {
	/** Records on this page. */
	records: ScoredRecord[]
	/** Cursor for the next page, or `undefined` on the last page. */
	nextCursor?: string
}

/** Dependencies of the snapshot store. Tests inject a clock and a token source. */
export type ResultPageDependencies = {
	/** Generate a unique snapshot identifier. */
	randomId: () => string
	/** Current time in milliseconds since the epoch. */
	now: () => number
}

/** Bounds and options of the snapshot store. */
export type ResultPageOptions = {
	/** Maximum number of snapshots kept. Defaults to `DEFAULT_MAX_SNAPSHOTS`. */
	maxSnapshots?: number
	/** Snapshot lifetime in milliseconds. Defaults to `DEFAULT_TTL_MS`. */
	ttlMs?: number
	/** Whether to refresh a snapshot lifetime on access. Defaults to `false`. */
	refreshOnAccess?: boolean
}

/** In-memory store of result snapshots. */
export type ResultPageStore = {
	/** Store a ranking under one binding and return its snapshot identifier. */
	create: (records: ScoredRecord[], binding: SnapshotBinding) => ResultSnapshot
	/** Read one page from a snapshot and return a continuation cursor. */
	read: (options: {
		/** Snapshot identifier, or the one encoded in the cursor. */
		snapshotId?: string
		/** Query binding that must match the stored binding. */
		binding: SnapshotBinding
		/** Delivery size for one page. */
		pageSize?: number
		/** Opaque continuation cursor. */
		cursor?: string
	}) => ResultPage
	/** Return the number of stored snapshots. */
	size: () => number
}

/** Default maximum number of snapshots. */
const DEFAULT_MAX_SNAPSHOTS = 128

/** Default snapshot lifetime in minutes converted to milliseconds. */
const DEFAULT_TTL_MS = 5 * 60 * 1000

/** Read the default dependencies from the runtime. */
const defaultDependencies = (): ResultPageDependencies => ({
	randomId: () => crypto.randomUUID(),
	now: () => Date.now(),
})

/** Normalize a filter object for a stable binding key. */
const normalizeFilters = (filters: SnapshotBinding["filters"]): string => {
	const from = filters?.yearFrom
	const to = filters?.yearTo

	return `${from ?? ""}:${to ?? ""}`
}

/** Build a stable string key for the query binding. */
const bindingKey = (binding: SnapshotBinding): string => {
	const weights: IndexWeights = {
		syntax: binding.weights.syntax,
		semantic: binding.weights.semantic,
		keyword: binding.weights.keyword,
	}
	const minScore = Math.round(binding.minScore / SCORE_TOLERANCE)

	return [
		binding.text,
		JSON.stringify(weights),
		String(minScore),
		normalizeFilters(binding.filters),
		binding.generation,
	].join("|")
}

/** Encode a snapshot identifier and an offset into an opaque cursor. */
const encodeCursor = (snapshotId: string, offset: number): string =>
	Buffer.from(`${snapshotId}:${offset}`, "utf8").toString("base64url")

/** Decode an opaque cursor into a snapshot identifier and an offset. */
const decodeCursor = (cursor: string): { snapshotId: string; offset: number } | undefined => {
	let decoded: string

	try {
		decoded = Buffer.from(cursor, "base64url").toString("utf8")
	} catch {
		return undefined
	}

	const separator = decoded.lastIndexOf(":")

	if (separator <= 0) {
		return undefined
	}

	const snapshotId = decoded.slice(0, separator)
	const offset = Number.parseInt(decoded.slice(separator + 1), 10)

	if (!Number.isSafeInteger(offset) || offset < 0) {
		return undefined
	}

	return { snapshotId, offset }
}

/**
 * Create a result page store.
 *
 * The store keeps a bounded map of snapshots. A new snapshot evicts the oldest
 * snapshot that no page is reading. When every snapshot is fresh and the bound
 * is reached, the store rejects the new snapshot with a capacity error rather
 * than silently truncate a result.
 *
 * `read` rejects a cursor when the snapshot is unknown or expired, and it
 * rejects any read when the binding does not match the stored binding.
 */
export const createResultPageStore = (
	dependencies: ResultPageDependencies = defaultDependencies(),
	options: ResultPageOptions = {},
): ResultPageStore => {
	const maxSnapshots = options.maxSnapshots ?? DEFAULT_MAX_SNAPSHOTS
	const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
	const refreshOnAccess = options.refreshOnAccess ?? false
	const snapshots = new Map<string, { snapshot: ResultSnapshot; key: string }>()

	/** Drop every expired snapshot. */
	const prune = (): void => {
		const now = dependencies.now()

		for (const [id, entry] of snapshots) {
			if (now - entry.snapshot.lastAccessAt > ttlMs) {
				snapshots.delete(id)
			}
		}
	}

	const size = (): number => {
		prune()

		return snapshots.size
	}

	const create = (records: ScoredRecord[], binding: SnapshotBinding): ResultSnapshot => {
		prune()

		if (snapshots.size >= maxSnapshots) {
			const oldest = [...snapshots.entries()].sort(
				([, left], [, right]) => left.snapshot.lastAccessAt - right.snapshot.lastAccessAt,
			)[0]

			if (oldest !== undefined) {
				snapshots.delete(oldest[0])
			} else {
				throw new SnapshotCapacityError(maxSnapshots)
			}
		}

		const now = dependencies.now()
		const snapshot: ResultSnapshot = {
			id: dependencies.randomId(),
			records,
			generation: binding.generation,
			createdAt: now,
			lastAccessAt: now,
		}

		snapshots.set(snapshot.id, { snapshot, key: bindingKey(binding) })

		return snapshot
	}

	const read = (request: {
		snapshotId?: string
		binding: SnapshotBinding
		pageSize?: number
		cursor?: string
	}): ResultPage => {
		prune()

		let snapshotId = request.snapshotId
		let offset = 0

		if (request.cursor !== undefined) {
			const decoded = decodeCursor(request.cursor)

			if (decoded === undefined) {
				throw new CursorMismatchError()
			}

			snapshotId = decoded.snapshotId
			offset = decoded.offset
		}

		if (snapshotId === undefined) {
			throw new CursorMismatchError()
		}

		const entry = snapshots.get(snapshotId)

		if (entry === undefined) {
			throw new CursorExpiredError()
		}

		if (entry.key !== bindingKey(request.binding)) {
			throw new CursorMismatchError()
		}

		if (refreshOnAccess) {
			entry.snapshot.lastAccessAt = dependencies.now()
		}

		const pageSize = request.pageSize ?? entry.snapshot.records.length
		const records = entry.snapshot.records.slice(offset, offset + pageSize)
		const nextOffset = offset + records.length

		if (nextOffset >= entry.snapshot.records.length) {
			return { records }
		}

		return { records, nextCursor: encodeCursor(snapshotId, nextOffset) }
	}

	return { create, read, size }
}
