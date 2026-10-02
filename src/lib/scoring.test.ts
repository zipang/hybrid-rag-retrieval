import { describe, expect, test } from "bun:test"
import type { IndexWeights } from "./retrieval-contract"
import {
	BM25_SCALE,
	clamp01,
	combineScores,
	compareIdentifiers,
	meetsThreshold,
	NORMALIZATION_VERSION,
	normalizeBm25,
	normalizeCosine,
	normalizeIndexScore,
	normalizeMultivectorMaxSim,
	SCORE_TOLERANCE,
	scoreAndOrder,
	sumWeights,
	validateWeights,
	WEIGHT_TOLERANCE,
} from "./scoring"

describe("clamp01", () => {
	test("clips out-of-range values into [0, 1]", () => {
		expect(clamp01(-1)).toBe(0)
		expect(clamp01(0)).toBe(0)
		expect(clamp01(0.5)).toBe(0.5)
		expect(clamp01(1)).toBe(1)
		expect(clamp01(2)).toBe(1)
	})

	test("maps nonfinite values to zero", () => {
		expect(clamp01(Number.NaN)).toBe(0)
		expect(clamp01(Number.POSITIVE_INFINITY)).toBe(0)
		expect(clamp01(Number.NEGATIVE_INFINITY)).toBe(0)
	})
})

describe("normalizeCosine", () => {
	test("maps negative cosine to zero and preserves positive cosine", () => {
		expect(normalizeCosine(-1)).toBe(0)
		expect(normalizeCosine(-0.2)).toBe(0)
		expect(normalizeCosine(0)).toBe(0)
		expect(normalizeCosine(0.42)).toBe(0.42)
		expect(normalizeCosine(1)).toBe(1)
		expect(normalizeCosine(1.5)).toBe(1)
	})
})

describe("normalizeBm25", () => {
	test("uses raw / (raw + scale) with the frozen scale", () => {
		expect(BM25_SCALE).toBe(3)
		expect(normalizeBm25(3)).toBeCloseTo(0.5, 12)
		expect(normalizeBm25(9)).toBeCloseTo(0.75, 12)
		expect(normalizeBm25(1)).toBeCloseTo(0.25, 12)
	})

	test("is monotonic and stays inside [0, 1)", () => {
		const values = [0.78, 1.56, 3.27, 4.95].map((raw) => normalizeBm25(raw))

		for (let i = 1; i < values.length; i += 1) {
			const previous = values[i - 1] ?? 0
			const current = values[i] ?? 0

			expect(current).toBeGreaterThan(previous)
		}

		for (const value of values) {
			expect(value).toBeGreaterThanOrEqual(0)
			expect(value).toBeLessThan(1)
		}
	})

	test("maps zero, negative, and nonfinite raw scores to zero", () => {
		expect(normalizeBm25(0)).toBe(0)
		expect(normalizeBm25(-2)).toBe(0)
		expect(normalizeBm25(Number.NaN)).toBe(0)
		expect(normalizeBm25(Number.POSITIVE_INFINITY)).toBe(0)
	})

	test("maps an invalid scale to zero", () => {
		expect(normalizeBm25(5, 0)).toBe(0)
		expect(normalizeBm25(5, -1)).toBe(0)
		expect(normalizeBm25(5, Number.NaN)).toBe(0)
	})
})

describe("normalizeIndexScore", () => {
	test("routes keyword to BM25 and dense indexes to cosine", () => {
		expect(normalizeIndexScore("keyword", 3)).toBeCloseTo(0.5, 12)
		expect(normalizeIndexScore("semantic", 0.5)).toBe(0.5)
		expect(normalizeIndexScore("syntax", 0.5)).toBe(0.5)
		expect(normalizeIndexScore("semantic", -1)).toBe(0)
	})
})

describe("normalizeMultivectorMaxSim", () => {
	test("scores a perfect equal-length match at one", () => {
		expect(normalizeMultivectorMaxSim(1, 1, 1)).toBe(1)
		expect(normalizeMultivectorMaxSim(2, 2, 2)).toBe(1)
		expect(normalizeMultivectorMaxSim(5, 5, 5)).toBe(1)
	})

	test("divides by the larger row count", () => {
		expect(normalizeMultivectorMaxSim(1, 1, 2)).toBe(0.5)
		expect(normalizeMultivectorMaxSim(2, 2, 1)).toBe(1)
		expect(normalizeMultivectorMaxSim(2, 2, 4)).toBe(0.5)
	})

	test("maps a nonmatch to zero", () => {
		expect(normalizeMultivectorMaxSim(0, 1, 1)).toBe(0)
		expect(normalizeMultivectorMaxSim(0.0002, 1, 2)).toBeCloseTo(0.0001, 12)
	})

	test("stays inside [0, 1]", () => {
		for (const [raw, q, r] of [
			[1.2, 1, 1],
			[3, 2, 2],
			[10, 5, 1],
		] as const) {
			const value = normalizeMultivectorMaxSim(raw, q, r)

			expect(value).toBeGreaterThanOrEqual(0)
			expect(value).toBeLessThanOrEqual(1)
		}
	})

	test("maps invalid inputs to zero", () => {
		expect(normalizeMultivectorMaxSim(Number.NaN, 1, 1)).toBe(0)
		expect(normalizeMultivectorMaxSim(Number.POSITIVE_INFINITY, 1, 1)).toBe(0)
		expect(normalizeMultivectorMaxSim(1, 0, 0)).toBe(0)
		expect(normalizeMultivectorMaxSim(1, Number.NaN, 1)).toBe(0)
	})
})

describe("sumWeights", () => {
	test("sums the positive finite entries", () => {
		expect(sumWeights({ syntax: 0.5, semantic: 0.3, keyword: 0.2 })).toBeCloseTo(1, 12)
		expect(sumWeights({ syntax: 1 })).toBe(1)
		expect(sumWeights({})).toBe(0)
	})

	test("ignores negative and nonfinite entries", () => {
		expect(sumWeights({ syntax: 1, semantic: -1 })).toBe(1)
		expect(sumWeights({ syntax: 1, semantic: Number.NaN })).toBe(1)
		expect(sumWeights({ syntax: 1, semantic: Number.POSITIVE_INFINITY })).toBe(1)
	})
})

describe("validateWeights", () => {
	test("accepts weights that sum to one", () => {
		const result = validateWeights({ syntax: 0.5, semantic: 0.5 })

		expect(result.valid).toBe(true)

		if (result.valid) {
			expect(result.weights).toEqual({ syntax: 0.5, semantic: 0.5, keyword: 0 })
		}
	})

	test("accepts a single index with weight one", () => {
		const result = validateWeights({ keyword: 1 })

		expect(result.valid).toBe(true)

		if (result.valid) {
			expect(result.weights.keyword).toBe(1)
		}
	})

	test("accepts a sum within the tolerance", () => {
		const result = validateWeights({ syntax: 1 / 3, semantic: 1 / 3, keyword: 1 / 3 })

		expect(result.valid).toBe(true)
		expect(WEIGHT_TOLERANCE).toBeGreaterThan(0)
	})

	test("rejects unknown index names", () => {
		const result = validateWeights({ syntax: 1, lexical: 0 } as IndexWeights)

		expect(result.valid).toBe(false)

		if (!result.valid) {
			expect(result.reason).toContain("unknown index name")
		}
	})

	test("rejects a negative, nonfinite, or zero-sum weight set", () => {
		expect(validateWeights({ syntax: 1.2, semantic: -0.2 }).valid).toBe(false)
		expect(validateWeights({ syntax: Number.NaN }).valid).toBe(false)
		expect(validateWeights({}).valid).toBe(false)
	})

	test("rejects a sum that misses one", () => {
		const result = validateWeights({ syntax: 0.5, semantic: 0.4 })

		expect(result.valid).toBe(false)

		if (!result.valid) {
			expect(result.reason).toContain("sum to 1")
		}
	})
})

describe("combineScores", () => {
	const weights = { syntax: 0.5, semantic: 0.3, keyword: 0.2 }

	test("computes the weighted sum of component scores", () => {
		const score = combineScores(weights, { syntax: 1, semantic: 0.5, keyword: 0.5 })

		expect(score).toBeCloseTo(0.5 + 0.15 + 0.1, 12)
	})

	test("treats a missing component as zero", () => {
		expect(combineScores(weights, { syntax: 1 })).toBeCloseTo(0.5, 12)
	})

	test("ignores zero-weight indexes", () => {
		expect(
			combineScores({ syntax: 1, semantic: 0, keyword: 0 }, { syntax: 0.25, semantic: 1 }),
		).toBeCloseTo(0.25, 12)
	})

	test("clamps nonfinite component values to zero", () => {
		expect(combineScores(weights, { syntax: Number.NaN, semantic: 0.5 })).toBeCloseTo(0.15, 12)
		expect(combineScores(weights, { syntax: Number.POSITIVE_INFINITY })).toBe(0)
	})
})

describe("meetsThreshold", () => {
	test("uses an inclusive threshold", () => {
		expect(meetsThreshold(0.8, 0.8)).toBe(true)
		expect(meetsThreshold(0.8, 0.7)).toBe(true)
		expect(meetsThreshold(0.7, 0.8)).toBe(false)
	})

	test("treats a boundary difference inside the tolerance as a match", () => {
		expect(meetsThreshold(0.8 - SCORE_TOLERANCE / 2, 0.8)).toBe(true)
		expect(meetsThreshold(0.8 - SCORE_TOLERANCE * 2, 0.8)).toBe(false)
	})

	test("qualifies zero-score records at a zero threshold", () => {
		expect(meetsThreshold(0, 0)).toBe(true)
	})

	test("rejects nonfinite scores", () => {
		expect(meetsThreshold(Number.NaN, 0)).toBe(false)
		expect(meetsThreshold(1, Number.NaN)).toBe(false)
	})
})

describe("compareIdentifiers", () => {
	test("orders numbers by value and strings by code unit", () => {
		expect(compareIdentifiers(1, 2)).toBeLessThan(0)
		expect(compareIdentifiers(2, 1)).toBeGreaterThan(0)
		expect(compareIdentifiers(1, 1)).toBe(0)
		expect(compareIdentifiers("a", "b")).toBeLessThan(0)
		expect(compareIdentifiers("b", "a")).toBeGreaterThan(0)
	})

	test("orders a number before a string", () => {
		expect(compareIdentifiers(1, "a")).toBeLessThan(0)
		expect(compareIdentifiers("a", 1)).toBeGreaterThan(0)
	})
})

describe("scoreAndOrder", () => {
	test("orders by combined score descending", () => {
		const weights = { syntax: 1, semantic: 0, keyword: 0 }
		const ordered = scoreAndOrder(weights, [
			{ id: 1, scores: { syntax: 0.2 } },
			{ id: 2, scores: { syntax: 0.9 } },
			{ id: 3, scores: { syntax: 0.5 } },
		])

		expect(ordered.map((record) => record.id)).toEqual([2, 3, 1])
	})

	test("breaks ties by identifier ascending", () => {
		const weights = { syntax: 1, semantic: 0, keyword: 0 }
		const ordered = scoreAndOrder(weights, [
			{ id: 3, scores: { syntax: 1 } },
			{ id: 1, scores: { syntax: 1 } },
			{ id: 2, scores: { syntax: 1 } },
		])

		expect(ordered.map((record) => record.id)).toEqual([1, 2, 3])
	})

	test("keeps tied scores for identical component vectors", () => {
		const weights = { semantic: 0.5, keyword: 0.5 }
		const ordered = scoreAndOrder(weights, [
			{ id: 1, scores: { semantic: 1, keyword: 0.78 } },
			{ id: 2, scores: { semantic: 1, keyword: 0.78 } },
		])

		const [first, second] = ordered

		expect(first?.score).toBeCloseTo(second?.score ?? Number.NaN, 12)
		expect(ordered.map((record) => record.id)).toEqual([1, 2])
	})

	test("does not filter by a threshold", () => {
		const weights = { syntax: 1, semantic: 0, keyword: 0 }
		const ordered = scoreAndOrder(weights, [
			{ id: 1, scores: { syntax: 0 } },
			{ id: 2, scores: { syntax: 1 } },
		])

		expect(ordered).toHaveLength(2)
	})

	test("produces the same order for the same input", () => {
		const weights = { syntax: 0.5, semantic: 0.5 }
		const input = [
			{ id: "b", scores: { syntax: 0.5, semantic: 0.5 } },
			{ id: "a", scores: { syntax: 0.5, semantic: 0.5 } },
		]

		expect(scoreAndOrder(weights, input)).toEqual(scoreAndOrder(weights, input))
	})
})

describe("normalization version", () => {
	test("is a nonempty string", () => {
		expect(typeof NORMALIZATION_VERSION).toBe("string")
		expect(NORMALIZATION_VERSION.length).toBeGreaterThan(0)
	})
})
