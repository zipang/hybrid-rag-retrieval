import type { IndexScore } from "./qdrant";

/** One captured state of the live collection. */
export type BaselineSnapshot = {
	/** Version reported by `GET /`. */
	version: string;
	/** Collection name. */
	collection: string;
	/** ISO-8601 capture time. Ignored by the comparison. */
	capturedAt: string;
	/** Point count reported by the collection info endpoint. */
	pointsCount: number;
	/** Query texts, in capture order. */
	queries: string[];
	/** Exact dense result per query, in capture order. */
	dense: IndexScore[][];
	/** Exact sparse BM25 result per query, in capture order. */
	sparse: IndexScore[][];
	/** Identifier of the hybrid result per query, best first. */
	hybrid: Array<Array<number | string>>;
};

/** Findings of one baseline comparison. */
export type BaselineDiff = {
	/** Differences that prove data loss or score drift. */
	blockers: string[];
	/** Differences that an upgrade may cause, and that a human must read. */
	warnings: string[];
};

/**
 * Largest absolute score difference that the comparison accepts.
 *
 * Qdrant returns `float32` similarities. The exact index adds the products in a fixed order, so the
 * score of one pair must be stable, but a re-serialized value can differ in the last bits. One
 * millionth is far below a meaningful change and far above the float32 round-off.
 */
const SCORE_TOLERANCE = 1e-6;

/** One comparison finding, before it is split into blockers and warnings. */
type Finding = {
	/** Severity that decides the output list. */
	kind: "blocker" | "warning";
	/** Query position, or `-1` for a finding about the whole snapshot. */
	index: number;
	/** Human-readable message. */
	message: string;
};

/** Compare two finite scores with the tolerance of the snapshot format. */
const scoresDiffer = (before: number, after: number): boolean => {
	const difference = after - before;

	return !Number.isFinite(difference) || Math.abs(difference) > SCORE_TOLERANCE;
};

/** Index one score list by identifier, keeping the first entry of a duplicate. */
const byIdentifier = (scores: IndexScore[]): Map<string, number> => {
	const map = new Map<string, number>();

	for (const entry of scores) {
		const key = String(entry.id);

		if (!map.has(key)) {
			map.set(key, entry.score);
		}
	}

	return map;
};

/**
 * Compare one exact score list, by identifier instead of by array position.
 *
 * Qdrant does not promise an order for an exact search: two points with equal scores can come back
 * in either order. The identifier and its score are the facts that must survive an upgrade.
 */
const compareExact = (
	label: "dense" | "sparse",
	queryIndex: number,
	before: IndexScore[],
	after: IndexScore[],
	findings: Finding[]
): void => {
	const beforeScores = byIdentifier(before);
	const afterScores = byIdentifier(after);

	for (const [key, score] of beforeScores) {
		const other = afterScores.get(key);

		if (other === undefined) {
			findings.push({
				kind: "blocker",
				index: queryIndex,
				message: `query[${queryIndex}]: ${label} result is missing identifier ${key} in the after snapshot`
			});

			continue;
		}

		if (scoresDiffer(score, other)) {
			findings.push({
				kind: "blocker",
				index: queryIndex,
				message:
					`query[${queryIndex}]: ${label} score for identifier ${key} differs by ` +
					`${Math.abs(other - score)} (before ${score}, after ${other})`
			});
		}
	}

	for (const key of afterScores.keys()) {
		if (!beforeScores.has(key)) {
			findings.push({
				kind: "blocker",
				index: queryIndex,
				message: `query[${queryIndex}]: ${label} result is missing identifier ${key} in the before snapshot`
			});
		}
	}
};

/** Count the identifiers that two hybrid lists share. */
const commonCount = (before: Array<number | string>, after: Array<number | string>): number => {
	const beforeIds = new Set(before.map(String));
	const afterIds = new Set(after.map(String));
	let count = 0;

	for (const id of beforeIds) {
		if (afterIds.has(id)) {
			count += 1;
		}
	}

	return count;
};

/** Split the findings into the two output lists, sorted by query index. */
const toDiff = (findings: Finding[]): BaselineDiff => {
	const sorted = [...findings].sort((left, right) => left.index - right.index);

	return {
		blockers: sorted.filter((finding) => finding.kind === "blocker").map((f) => f.message),
		warnings: sorted.filter((finding) => finding.kind === "warning").map((f) => f.message)
	};
};

/**
 * Compare two baselines of the same collection.
 *
 * The comparison answers one question: did the data and the exact scores survive the upgrade? A
 * version change and a hybrid reorder are expected, so they become warnings. A lost point, a lost
 * identifier, or a moved exact score is a blocker. `capturedAt` is ignored, because it always
 * differs.
 */
export const compareBaselines = (
	before: BaselineSnapshot,
	after: BaselineSnapshot
): BaselineDiff => {
	const findings: Finding[] = [];

	if (before.version !== after.version) {
		findings.push({
			kind: "warning",
			index: -1,
			message: `version differs: before ${before.version}, after ${after.version}`
		});
	}

	if (before.collection !== after.collection) {
		findings.push({
			kind: "blocker",
			index: -1,
			message: `collection differs: before "${before.collection}", after "${after.collection}"`
		});
	}

	if (before.pointsCount !== after.pointsCount) {
		findings.push({
			kind: "blocker",
			index: -1,
			message: `pointsCount differs: before ${before.pointsCount}, after ${after.pointsCount}`
		});
	}

	if (before.queries.length !== after.queries.length) {
		findings.push({
			kind: "blocker",
			index: -1,
			message: `query count differs: before ${before.queries.length}, after ${after.queries.length}`
		});
	}

	const commonQueries = Math.min(before.queries.length, after.queries.length);

	for (let index = 0; index < commonQueries; index += 1) {
		const beforeQuery = before.queries[index];
		const afterQuery = after.queries[index];

		if (beforeQuery !== afterQuery) {
			findings.push({
				kind: "blocker",
				index,
				message: `query[${index}]: query text differs: before "${beforeQuery}", after "${afterQuery}"`
			});

			continue;
		}

		compareExact("dense", index, before.dense[index] ?? [], after.dense[index] ?? [], findings);
		compareExact(
			"sparse",
			index,
			before.sparse[index] ?? [],
			after.sparse[index] ?? [],
			findings
		);

		const beforeHybrid = before.hybrid[index] ?? [];
		const afterHybrid = after.hybrid[index] ?? [];

		if (beforeHybrid.join(",") !== afterHybrid.join(",")) {
			findings.push({
				kind: "warning",
				index,
				message:
					`query[${index}]: hybrid order differs for "${beforeQuery}" ` +
					`(${commonCount(beforeHybrid, afterHybrid)} of ${beforeHybrid.length} identifiers in common)`
			});
		}
	}

	return toDiff(findings);
};
