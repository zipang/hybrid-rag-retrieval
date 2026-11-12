import { describe, expect, test } from "bun:test";
import { type BaselineSnapshot, compareBaselines } from "./qdrant-baseline";

/** Build a snapshot with two queries, one dense and one sparse score per query. */
const snapshot = (overrides: Partial<BaselineSnapshot> = {}): BaselineSnapshot => ({
	version: "1.20.0",
	collection: "slogans",
	capturedAt: "2026-11-12T10:00:00.000Z",
	pointsCount: 236,
	queries: ["slogans sur le sucre", "slogans sur les produits laitiers"],
	dense: [
		[
			{ id: 1, score: 0.9 },
			{ id: 2, score: 0.8 }
		],
		[
			{ id: 3, score: 0.7 },
			{ id: 4, score: 0.6 }
		]
	],
	sparse: [
		[
			{ id: 1, score: 12.5 },
			{ id: 2, score: 9.25 }
		],
		[
			{ id: 3, score: 8.125 },
			{ id: 4, score: 4.5 }
		]
	],
	hybrid: [
		[1, 2],
		[3, 4]
	],
	...overrides
});

describe("compareBaselines", () => {
	test("gives no finding for identical snapshots, whatever the capture time", () => {
		const before = snapshot({ capturedAt: "2026-11-11T08:00:00.000Z" });
		const after = snapshot({ capturedAt: "2026-11-12T12:00:00.000Z" });

		expect(compareBaselines(before, after)).toEqual({ blockers: [], warnings: [] });
	});

	test("reports a version change as a warning that names both versions", () => {
		const before = snapshot({ version: "1.19.1" });

		const diff = compareBaselines(before, snapshot());

		expect(diff.blockers).toEqual([]);
		expect(diff.warnings).toHaveLength(1);
		expect(diff.warnings[0]).toContain("1.19.1");
		expect(diff.warnings[0]).toContain("1.20.0");
	});

	test("reports a collection change as a blocker", () => {
		const diff = compareBaselines(
			snapshot({ collection: "slogans" }),
			snapshot({ collection: "citations" })
		);

		expect(diff.blockers).toHaveLength(1);
		expect(diff.blockers[0]).toContain("slogans");
		expect(diff.blockers[0]).toContain("citations");
		expect(diff.warnings).toEqual([]);
	});

	test("reports a point-count change as a blocker", () => {
		const diff = compareBaselines(
			snapshot({ pointsCount: 236 }),
			snapshot({ pointsCount: 235 })
		);

		expect(diff.blockers).toHaveLength(1);
		expect(diff.blockers[0]).toContain("236");
		expect(diff.blockers[0]).toContain("235");
	});

	test("reports a different query count as a blocker", () => {
		const before = snapshot();
		const after = snapshot({
			queries: ["slogans sur le sucre"],
			dense: [before.dense[0]],
			sparse: [before.sparse[0]],
			hybrid: [before.hybrid[0]]
		});

		const diff = compareBaselines(before, after);

		expect(diff.blockers).toHaveLength(1);
		expect(diff.blockers[0]).toContain("2");
		expect(diff.blockers[0]).toContain("1");
	});

	test("reports a different query text at the same position as a blocker", () => {
		const after = snapshot({
			queries: ["slogans sur le sucre roux", "slogans sur les produits laitiers"]
		});

		const diff = compareBaselines(snapshot(), after);

		expect(diff.blockers).toHaveLength(1);
		expect(diff.blockers[0]).toContain("0");
		expect(diff.blockers[0]).toContain("slogans sur le sucre roux");
	});

	test("reports a dense identifier that the after snapshot lost", () => {
		const after = snapshot({
			dense: [
				[{ id: 1, score: 0.9 }],
				[
					{ id: 3, score: 0.7 },
					{ id: 4, score: 0.6 }
				]
			]
		});

		const diff = compareBaselines(snapshot(), after);

		expect(diff.blockers).toHaveLength(1);
		expect(diff.blockers[0]).toContain("2");
		expect(diff.blockers[0]).toContain("dense");
	});

	test("reports a dense score drift above 1e-6 as a blocker", () => {
		const after = snapshot({
			dense: [
				[
					{ id: 1, score: 0.9 },
					{ id: 2, score: 0.8000011 }
				],
				[
					{ id: 3, score: 0.7 },
					{ id: 4, score: 0.6 }
				]
			]
		});

		const diff = compareBaselines(snapshot(), after);

		expect(diff.blockers).toHaveLength(1);
		expect(diff.blockers[0]).toContain("2");
		expect(diff.blockers[0]).toContain("dense");
	});

	test("accepts a dense score drift below 1e-6", () => {
		const after = snapshot({
			dense: [
				[
					{ id: 1, score: 0.9 },
					{ id: 2, score: 0.8 + 0.9e-6 }
				],
				[
					{ id: 3, score: 0.7 },
					{ id: 4, score: 0.6 }
				]
			]
		});

		expect(compareBaselines(snapshot(), after)).toEqual({ blockers: [], warnings: [] });
	});

	test("does not report a reordered exact result with identical scores", () => {
		const after = snapshot({
			dense: [
				[
					{ id: 2, score: 0.8 },
					{ id: 1, score: 0.9 }
				],
				[
					{ id: 3, score: 0.7 },
					{ id: 4, score: 0.6 }
				]
			],
			sparse: [
				[
					{ id: 2, score: 9.25 },
					{ id: 1, score: 12.5 }
				],
				[
					{ id: 3, score: 8.125 },
					{ id: 4, score: 4.5 }
				]
			]
		});

		expect(compareBaselines(snapshot(), after)).toEqual({ blockers: [], warnings: [] });
	});

	test("reports a sparse identifier and a sparse score drift as blockers", () => {
		const after = snapshot({
			sparse: [
				[
					{ id: 1, score: 12.5 },
					{ id: 2, score: 9.3 }
				],
				[{ id: 3, score: 8.125 }]
			]
		});

		const diff = compareBaselines(snapshot(), after);

		expect(diff.blockers).toHaveLength(2);
		expect(diff.blockers.some((entry) => entry.includes("sparse") && entry.includes("2"))).toBe(
			true
		);
		expect(diff.blockers.some((entry) => entry.includes("sparse") && entry.includes("4"))).toBe(
			true
		);
	});

	test("reports a hybrid reorder as a warning with the query and the common count", () => {
		const after = snapshot({
			hybrid: [
				[2, 1],
				[3, 4]
			]
		});

		const diff = compareBaselines(snapshot(), after);

		expect(diff.blockers).toEqual([]);
		expect(diff.warnings).toHaveLength(1);
		expect(diff.warnings[0]).toContain("slogans sur le sucre");
		expect(diff.warnings[0]).toContain("2");
	});

	test("sorts blockers by query index before the warnings", () => {
		const after = snapshot({
			version: "1.19.1",
			dense: [
				[
					{ id: 1, score: 0.9 },
					{ id: 2, score: 0.5 }
				],
				[
					{ id: 3, score: 0.7 },
					{ id: 4, score: 0.6 }
				]
			],
			sparse: [
				[
					{ id: 1, score: 12.5 },
					{ id: 2, score: 9.25 }
				],
				[{ id: 3, score: 8.125 }]
			],
			hybrid: [
				[1, 2],
				[4, 3]
			]
		});

		const diff = compareBaselines(snapshot(), after);

		expect(diff.blockers).toHaveLength(2);
		expect(diff.blockers[0]).toContain("query[0]");
		expect(diff.blockers[1]).toContain("query[1]");
		expect(diff.warnings).toHaveLength(2);
		expect(diff.warnings[0]).toContain("version");
		expect(diff.warnings[1]).toContain("query[1]");
	});
});
