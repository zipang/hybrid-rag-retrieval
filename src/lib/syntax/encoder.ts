/**
 * Syntax encoder.
 *
 * The encoder turns an abstract tree into a fixed-length numeric vector. The
 * vector captures the structure: the word classes, the labeled connections, the
 * relative order, and the rooted paths. It never sees a word or a lemma.
 *
 * The encoder uses feature hashing. It maps each structural feature to a bucket
 * in a fixed-length vector. Each feature carries a weight, so a core role
 * counts more than a modifier. The weights come from the test data set
 * evaluation. The plan records the finding in `memos/syntax-trees.md`,
 * section 9.
 *
 * The configuration is versioned. The same tree and the same configuration
 * always give the same vector.
 */

import type { AbstractNode, AbstractSentence, AbstractTree, SyntaxProfile } from "./abstraction"

/** Frozen encoder configuration. */
export type EncoderConfig = {
	/** Configuration version. A change of weights or rules bumps it. */
	version: string
	/** Number of buckets in the output vector. */
	dimensions: number
	/** Weight of one abstract node, keyed by its word class. */
	uposWeights: Record<string, number>
	/** Weight of one labeled edge, keyed by its base dependency label. */
	roleWeights: Record<string, number>
	/** Weight of a rooted-path feature. */
	pathWeight: number
	/**
	 * Fixed number of digits in a path index.
	 *
	 * The width is a configuration constant, not the depth of one tree. A fixed
	 * width keeps a node's index stable when another branch grows deeper. A node
	 * deeper than this value clamps to `pathDepth` digits.
	 */
	pathDepth: number
	/** Hash seed, so two configurations can differ. */
	seed: string
}

/**
 * The frozen configuration for this ticket.
 *
 * The role weights make a core role count more than a modifier. The weights
 * follow the `role` scheme measured at Checkpoint B: core roles (`root`,
 * `nsubj`, `obj`) are heavier than modifiers (`advmod`, `det`, `expl`). The
 * `coarse` profile keeps base labels, so the role table uses base labels.
 */
export const DEFAULT_ENCODER_CONFIG: EncoderConfig = {
	version: "coarse-1",
	dimensions: 256,
	uposWeights: {
		VERB: 3,
		AUX: 2.5,
		NOUN: 3,
		PROPN: 3,
		PRON: 2,
		NUM: 2,
		ADJ: 2,
		DET: 1,
		ADV: 0.5,
		ADP: 0.5,
		CCONJ: 0.5,
		SCONJ: 0.5,
	},
	roleWeights: {
		root: 3,
		nsubj: 3,
		obj: 3,
		iobj: 3,
		csubj: 2.5,
		ccomp: 2.5,
		xcomp: 2.5,
		advcl: 2,
		acl: 2,
		obl: 2,
		conj: 2,
		cop: 1.5,
		amod: 1,
		advmod: 0.7,
		expl: 0.7,
		aux: 0.5,
		det: 0.5,
		case: 0.5,
		mark: 0.5,
		cc: 0.5,
	},
	pathWeight: 1,
	pathDepth: 6,
	seed: "t0004-coarse",
}

/** One abstract tree encoded as a sparse vector, before normalization. */
export type EncodedVector = {
	/** Configuration version that produced the vector. */
	version: string
	/** Vector length. */
	dimensions: number
	/** Dense vector, L2-normalized. */
	values: number[]
}

/** Return the weight of a word class, with a default for an unknown class. */
const uposWeight = (config: EncoderConfig, upos: string): number => config.uposWeights[upos] ?? 1

/** Return the weight of an edge role, with a default for an unknown role. */
const roleWeight = (config: EncoderConfig, deprel: string): number =>
	config.roleWeights[deprel] ?? 1

/** Return a stable, small integer hash of a string with the config seed. */
const hash = (config: EncoderConfig, feature: string): number => {
	const input = `${config.seed}:${feature}`
	let value = 2166136261

	for (let index = 0; index < input.length; index += 1) {
		value ^= input.charCodeAt(index)
		value = Math.imul(value, 16777619)
	}

	return (value >>> 0) % config.dimensions
}

/**
 * Build the child lists of a sentence.
 *
 * `children[head]` holds the 1-based indices of the nodes whose head is the
 * given index. `children[0]` holds the root. The lists are in reading order.
 */
const childIndex = (sentence: AbstractSentence): number[][] => {
	const children: number[][] = sentence.nodes.map(() => [])

	sentence.nodes.forEach((node, offset) => {
		const parent = node.head
		const list = children[parent]

		if (list !== undefined) {
			list.push(offset + 1)
		}
	})

	return children
}

/** Return the head index of the node at a 1-based position. */
const headOf = (sentence: AbstractSentence, node: number): number =>
	sentence.nodes[node - 1]?.head ?? 0

/**
 * Return the sibling rank of a node among the children of its head.
 *
 * The rank is 1 for the first child, 2 for the second child, and so on, in
 * reading order. The rank depends only on the node's own parent, so an edit in
 * a different branch never changes it.
 */
const siblingRank = (children: number[][], parent: number, node: number): number => {
	const siblings = children[parent]

	if (siblings === undefined) {
		return 0
	}

	return siblings.indexOf(node) + 1
}

/**
 * Return one path index and its depth for every node of a sentence.
 *
 * The path index is a zero-padded numeric string: one digit per depth level.
 * The last digit is the sibling rank of the node itself, the digit before it is
 * the sibling rank of its parent, and so on to the root. Every index has the
 * same width, equal to the sentence's maximum depth. The root is all zeros.
 *
 * The padding makes a digit position mean one depth level. The index uses
 * sibling ranks only, so it does not shift when a node is added in a different
 * branch.
 */
type NodePosition = {
	/** Zero-padded path index, for example `011`. */
	index: string
	/** Number of edges to the root. The root has depth `0`. */
	depth: number
}

const sentencePositions = (
	sentence: AbstractSentence,
	children: number[][],
	pathDepth: number,
): NodePosition[] => {
	return sentence.nodes.map((_, offset) => {
		const node = offset + 1
		const digits: number[] = []
		const seen = new Set<number>()
		let current = node

		while (current !== 0 && !seen.has(current)) {
			seen.add(current)
			digits.push(siblingRank(children, headOf(sentence, current), current))
			current = headOf(sentence, current)
		}

		digits.reverse()

		// Keep the rightmost digits when the node is deeper than the width, so
		// the deepest levels stay visible and every index has the same length.
		const depth = digits.length
		const clamped = digits.slice(Math.max(0, depth - pathDepth))

		return { index: clamped.join("").padStart(pathDepth, "0"), depth }
	})
}

/** Add a weighted feature into the vector. */
const addFeature = (
	vector: number[],
	config: EncoderConfig,
	feature: string,
	weight: number,
): void => {
	vector[hash(config, feature)] += weight
}

/**
 * Encode one abstract sentence into a vector.
 *
 * The function adds three feature families. Every feature uses the tree
 * position, never the flat token distance:
 *
 * - one node feature per node, with the word class, the base label, and the
 *   zero-padded path index, weighted by the word class;
 * - one role feature per non-root node, with the base label, the word class,
 *   and the edge depth, weighted by the grammatical role;
 * - one rooted-path feature per node, with the base labels from the root to the
 *   node, weighted by the path weight.
 */
const encodeSentence = (
	vector: number[],
	sentence: AbstractSentence,
	config: EncoderConfig,
): void => {
	const { nodes, root } = sentence
	const children = childIndex(sentence)
	const positions = sentencePositions(sentence, children, config.pathDepth)

	for (const [offset, node] of nodes.entries()) {
		const nodeIndex = offset + 1
		const position = positions[offset] ?? { index: "", depth: 0 }

		addFeature(
			vector,
			config,
			`node:${node.upos}:${node.deprel}:${position.index}`,
			uposWeight(config, node.upos),
		)

		if (nodeIndex === root) {
			addFeature(vector, config, `root:${node.upos}:${position.index}`, roleWeight(config, "root"))
		} else {
			const feature = `role:${node.deprel}:${node.upos}:d${position.depth}`

			addFeature(vector, config, feature, roleWeight(config, node.deprel))
		}

		addFeature(vector, config, `path:${rootedPath(nodes, nodeIndex)}`, config.pathWeight)
	}
}

/**
 * Return the rooted path of a node as a string of base labels.
 *
 * The path starts at the root and ends at the node. Each label is the
 * dependency label of a node on the way. A guard stops a malformed cycle.
 */
const rootedPath = (nodes: AbstractNode[], nodeIndex: number): string => {
	const labels: string[] = []
	const seen = new Set<number>()
	let current = nodeIndex

	while (current !== 0 && !seen.has(current)) {
		seen.add(current)

		const node = nodes[current - 1]

		if (node === undefined) {
			break
		}

		labels.push(node.deprel)
		current = node.head
	}

	labels.reverse()

	return labels.join(">")
}

/**
 * Encode an abstract tree into one vector per sentence.
 *
 * The vector is L2-normalized, so cosine comparison is a dot product. A tree
 * with no feature produces a zero vector; the caller must treat that as an
 * error before indexing.
 */
export const encodeTree = (
	tree: AbstractTree,
	config: EncoderConfig = DEFAULT_ENCODER_CONFIG,
): EncodedVector[] => {
	return tree.sentences.map((sentence) => {
		const vector = new Array<number>(config.dimensions).fill(0)

		encodeSentence(vector, sentence, config)

		return {
			version: config.version,
			dimensions: config.dimensions,
			values: l2Normalize(vector),
		}
	})
}

/** Return a copy of a vector scaled to unit length. A zero vector stays zero. */
export const l2Normalize = (vector: number[]): number[] => {
	let sum = 0

	for (const value of vector) {
		sum += value * value
	}

	if (sum === 0) {
		return vector.slice()
	}

	const norm = Math.sqrt(sum)

	return vector.map((value) => value / norm)
}

/** Re-export the profile type for callers of the encoder. */
export type { SyntaxProfile }
