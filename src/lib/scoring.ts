/**
 * Index score normalization and weighted combination.
 *
 * Every selected index contributes a finite component score in `[0, 1]`. The
 * combined score is the weighted sum of those component scores. The functions
 * here are pure. They never read response maxima, page contents, or batch
 * statistics. The same inputs always produce the same outputs.
 *
 * The formulas and their parameters are versioned. A score from one
 * normalization version never mixes with a score from another version.
 */

import type { FullIndexWeights, IndexName, IndexScores, IndexWeights } from "./retrieval-contract"
import { INDEX_NAMES } from "./retrieval-contract"

/** Version of the normalization formulas. Bump when a formula or a parameter changes. */
export const NORMALIZATION_VERSION = "1"

/** BM25 scale parameter for `raw / (raw + scale)`. Positive and versioned. */
export const BM25_SCALE = 3

/** Numerical tolerance for weight sums and score comparisons. */
export const WEIGHT_TOLERANCE = 1e-9

/** Rounding tolerance for equality checks on combined scores. */
export const SCORE_TOLERANCE = 1e-9

/**
 * Clip a value into `[0, 1]`. Map `NaN`, `Infinity`, and `-Infinity` to zero.
 *
 * The function is the shared guard for every component score. A nonfinite value
 * becomes zero instead of an invalid score.
 */
export const clamp01 = (value: number): number => {
	if (!Number.isFinite(value)) {
		return 0
	}

	if (value < 0) {
		return 0
	}

	if (value > 1) {
		return 1
	}

	return value
}

/**
 * Normalize a cosine score into `[0, 1]`.
 *
 * The transformation is `max(0, min(1, cosine))`. It maps negative cosine
 * values to zero and preserves positive cosine values. This is the fixed,
 * documented transformation for the semantic and syntax indexes.
 */
export const normalizeCosine = (cosine: number): number => clamp01(cosine)

/**
 * Normalize a raw BM25 score into `[0, 1]`.
 *
 * The transformation is `raw / (raw + scale)`. For a nonnegative `raw` the
 * result lies in `[0, 1)` and grows monotonically. A raw score of zero and a
 * negative raw score map to zero. The scale is {@link BM25_SCALE}.
 */
export const normalizeBm25 = (raw: number, scale: number = BM25_SCALE): number => {
	if (!Number.isFinite(raw) || raw <= 0) {
		return 0
	}

	if (!Number.isFinite(scale) || scale <= 0) {
		return 0
	}

	return raw / (raw + scale)
}

/**
 * Normalize one component score by index name.
 *
 * Dense indexes use the cosine transformation. The keyword index uses the BM25
 * transformation. Both results lie in `[0, 1]`.
 */
export const normalizeIndexScore = (index: IndexName, raw: number): number => {
	if (index === "keyword") {
		return normalizeBm25(raw)
	}

	return normalizeCosine(raw)
}

/**
 * Normalize a raw Qdrant `max_sim` score into `[0, 1]`.
 *
 * Qdrant defines `max_sim` as the sum, over the query rows, of the best match
 * against the record rows. The raw value is therefore neither bounded nor
 * symmetric. The syntax index divides the raw value by the larger row count:
 *
 * ```text
 * score = rawMaxSim / max(queryRows, recordRows)
 * ```
 *
 * This rule matches the approved syntax normalization. A perfect match of equal
 * length scores one. An unmatched sentence on the longer side scores zero, and
 * the divisor averages that zero into the result. A raw value from a shorter
 * query never exceeds the divisor, because `max_sim` sums one best match per
 * query row and every match is at most one.
 *
 * A nonpositive or nonfinite raw value maps to zero. A zero denominator maps to
 * zero, because a record with no row cannot match.
 */
export const normalizeMultivectorMaxSim = (
	rawMaxSim: number,
	queryRows: number,
	recordRows: number,
): number => {
	const divisor = Math.max(queryRows, recordRows)

	if (!Number.isFinite(rawMaxSim) || rawMaxSim <= 0) {
		return 0
	}

	if (!Number.isFinite(divisor) || divisor <= 0) {
		return 0
	}

	return clamp01(rawMaxSim / divisor)
}

/** Read the value of one index in a partial record, or `undefined`. */
const readIndexValue = (record: IndexScores, index: IndexName): number | undefined => {
	return record[index]
}

/**
 * Sum the nonnegative, finite entries of an {@link IndexWeights} object.
 *
 * An absent entry contributes zero. A negative or nonfinite entry contributes
 * zero, because the validator rejects it before scoring.
 */
export const sumWeights = (weights: IndexWeights): number => {
	let total = 0

	for (const index of INDEX_NAMES) {
		const weight = readIndexValue(weights, index)

		if (weight !== undefined && Number.isFinite(weight) && weight > 0) {
			total += weight
		}
	}

	return total
}

/** The result of validating an {@link IndexWeights} object. */
export type WeightValidation =
	| { valid: true; weights: FullIndexWeights }
	| { valid: false; reason: string }

/**
 * Validate index weights against the contract.
 *
 * The rules are: at least one positive weight, every present weight is a
 * nonnegative finite number, no unknown index name, and the sum is one within
 * {@link WEIGHT_TOLERANCE}. The function never silently normalizes invalid
 * weights.
 */
export const validateWeights = (weights: IndexWeights): WeightValidation => {
	const full: FullIndexWeights = { syntax: 0, semantic: 0, keyword: 0 }
	let positive = 0

	for (const key of Object.keys(weights)) {
		if (!(INDEX_NAMES as readonly string[]).includes(key)) {
			return { valid: false, reason: `unknown index name: ${key}` }
		}
	}

	for (const index of INDEX_NAMES) {
		const weight = readIndexValue(weights, index)

		if (weight === undefined) {
			continue
		}

		if (!Number.isFinite(weight) || weight < 0) {
			return { valid: false, reason: `weight for ${index} must be a nonnegative finite number` }
		}

		if (weight > 0) {
			positive += 1
		}

		full[index] = weight
	}

	if (positive === 0) {
		return { valid: false, reason: "at least one weight must be positive" }
	}

	const total = sumWeights(weights)

	if (Math.abs(total - 1) > WEIGHT_TOLERANCE) {
		return { valid: false, reason: `weights must sum to 1 within ${WEIGHT_TOLERANCE}` }
	}

	return { valid: true, weights: full }
}

/**
 * Combine component scores with weights into one matching score.
 *
 * The function computes `sum(weight[index] * component[index])` over the
 * selected indexes. An absent component score contributes zero. Nonfinite
 * component values become zero. The result lies in `[0, 1]`.
 */
export const combineScores = (weights: FullIndexWeights, scores: IndexScores): number => {
	let total = 0

	for (const index of INDEX_NAMES) {
		const weight = weights[index]

		if (weight <= 0) {
			continue
		}

		const value = readIndexValue(scores, index)

		if (value === undefined) {
			continue
		}

		total += weight * clamp01(value)
	}

	return clamp01(total)
}

/**
 * Return whether a combined score meets a minimum score.
 *
 * The threshold is inclusive. A record with `combinedScore === minScore`
 * qualifies. The comparison uses {@link SCORE_TOLERANCE}, so floating-point
 * noise does not flip a boundary case.
 */
export const meetsThreshold = (
	combinedScore: number,
	minScore: number,
	tolerance: number = SCORE_TOLERANCE,
): boolean => {
	if (!Number.isFinite(combinedScore) || !Number.isFinite(minScore)) {
		return false
	}

	return combinedScore >= minScore - tolerance
}

/** One record prepared for combined scoring and ordering. */
export type ScoreInput = {
	/** Record identifier. */
	id: number | string
	/** Available component scores. Missing indexes contribute zero. */
	scores: IndexScores
}

/** One record with its combined score. */
export type ScoredRecord = {
	/** Record identifier. */
	id: number | string
	/** Combined matching score. */
	score: number
	/** Component scores that produced the combined score. */
	scores?: IndexScores
}

/**
 * Compare two identifiers for a deterministic ascending order.
 *
 * Two numeric identifiers compare by value. Two string identifiers compare by
 * code-unit order. A number sorts before a string. This makes the tie-breaker
 * total and stable across runs.
 */
export const compareIdentifiers = (left: number | string, right: number | string): number => {
	if (typeof left === "number" && typeof right === "number") {
		return left - right
	}

	if (typeof left === "string" && typeof right === "string") {
		if (left < right) {
			return -1
		}

		if (left > right) {
			return 1
		}

		return 0
	}

	return typeof left === "number" ? -1 : 1
}

/**
 * Score and order records by combined score descending, then by identifier.
 *
 * The function never filters by the threshold. The caller applies
 * {@link meetsThreshold} when it needs qualification. Keeping scoring and
 * qualification apart lets the pagination layer reuse one stable order.
 */
export const scoreAndOrder = (weights: FullIndexWeights, records: ScoreInput[]): ScoredRecord[] => {
	const scored = records.map((record) => ({
		id: record.id,
		score: combineScores(weights, record.scores),
		scores: record.scores,
	}))

	scored.sort((left, right) => {
		if (left.score !== right.score) {
			return right.score - left.score
		}

		return compareIdentifiers(left.id, right.id)
	})

	return scored
}
