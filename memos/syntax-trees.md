# Syntax trees — representation and encoding for the T0004 index

Ticket: `T0004` — related spec: `roadmap/T0004/spec.md`

This memo records how the project represents and encodes the grammatical
structure of an indexed text. The index needs a syntax vector. The vector must
capture grammar alone. Vocabulary, lemmas, and meaning stay out. The project
compared two tree formalisms and several encodings. The project selected
dependency trees in the CoNLL-U format. The evaluation in Task 1 and Task 11
will confirm the choice on the reviewed test data set.

## 1. What the syntax vector must capture

The specification states the goal. The syntax score "must use grammatical
structure alone." The specification gives one example pair:

- `Le garçon regarde le soleil`
- `Un chat mange une souris`

Both sentences have a verb, a nominal subject, a direct object, and a
determiner on each noun. Their coarse representations must match. Their words
and their meanings differ. The representation must ignore words and keep
structure.

The specification also sets a lower bound. "A word-class histogram or
word-class sequence alone does not meet this requirement." The representation
must keep the connections between words.

## 2. Candidate representations

| Representation | Shape | Status |
| --- | --- | --- |
| Dependency tree, CoNLL-U | Tree over words, typed relations | Selected |
| Constituency tree | Tree over phrases and words | Rejected |
| Word-class sequence | Flat list of word classes | Insufficient |
| Enhanced dependencies | Graph, not a tree | Out of scope |
| AMR (graph) | Graph of meaning | Out of scope |
| Source-code AST | Tree for code, not language | Rejected by the spec |

## 3. The dependency representation

Universal Dependencies (UD) defines the annotation. The CoNLL-U file format
carries it ([UD format specification](https://universaldependencies.org/format.html)).
A word line has ten fields:

```
ID  FORM  LEMMA  UPOS  XPOS  FEATS  HEAD  DEPREL  DEPS  MISC
```

The `HEAD` field is the identifier of the governor. The `DEPREL` field is the
label of the relation to that governor. The UD syntax page states the central
fact: "The *basic* dependency representation forms a tree, where exactly one
word is the head of the sentence, dependent on a notional ROOT and all other
words are dependent on another word"
([UD syntax principles](https://universaldependencies.org/u/overview/syntax.html)).
`HEAD = 0` marks the root.

UD makes content words the heads. Function words and punctuation attach as
leaves. The tree is therefore a list of word nodes. Each node stores the index
of its parent. This is an adjacency list. It carries the full tree, but it does
not show the hierarchy as visual nesting.

The first example sentence:

```
ID  FORM     UPOS  HEAD  DEPREL   FEATS
1   Le       DET   2     det      Definite=Def|Gender=Masc|Number=Sing
2   garçon   NOUN  3     nsubj    Gender=Masc|Number=Sing
3   regarde  VERB  0     root     Mood=Ind|Number=Sing|Person=3|Tense=Pres|VerbForm=Fin
4   le       DET   5     det      Definite=Def|Gender=Masc|Number=Sing
5   soleil   NOUN  3     obj      Gender=Masc|Number=Sing
```

The same tree as a nested structure:

```
regarde (VERB, root)
├── garçon (NOUN, nsubj)
│   └── Le (DET, det)
└── soleil (NOUN, obj)
    └── le (DET, det)
```

## 4. The constituency representation

A constituency tree has two node kinds: words and phrases. The phrase nodes
`NP`, `VP`, and `S` group words. The first example sentence:

```
S
├── NP
│   ├── DET Le
│   └── N garçon
└── VP
    ├── V regarde
    └── NP
        ├── DET le
        └── N soleil
```

The phrase node `NP` is explicit. The project considered this formalism because
the explicit phrase nodes are easy to read.

## 5. The grouping question

The reviewer asked how each formalism expresses the pair `Le garçon` and
`Le petit garçon`. Both are noun phrases. Adding the adjective is a small
change.

The second sentence `Le petit garçon regarde le soleil jaune` in CoNLL-U:

```
ID  FORM     UPOS  HEAD  DEPREL   FEATS
1   Le       DET   3     det      Definite=Def|Gender=Masc|Number=Sing
2   petit    ADJ   3     amod     Gender=Masc|Number=Sing
3   garçon   NOUN  4     nsubj    Gender=Masc|Number=Sing
4   regarde  VERB  0     root     Mood=Ind|Number=Sing|Person=3|Tense=Pres|VerbForm=Fin
5   le       DET   6     det      Definite=Def|Gender=Masc|Number=Sing
6   soleil   NOUN  4     obj      Gender=Masc|Number=Sing
7   jaune    ADJ   6     amod     Gender=Masc|Number=Sing
```

As a nested structure:

```
regarde (VERB, root)
├── garçon (NOUN, nsubj)
│   ├── Le (DET, det)
│   └── petit (ADJ, amod)
└── soleil (NOUN, obj)
    ├── le (DET, det)
    └── jaune (ADJ, amod)
```

A dependency tree has no phrase node. It has one node per word. The phrase
`Le garçon` becomes the **subtree rooted at the noun** `garçon`. The subtree
holds the `det` and `amod` dependents. Sentence 1 has one dependent under the
noun. Sentence 2 has two dependents under the noun. The adjective adds one edge
and one node.

A constituency tree keeps the `NP` node in both sentences. It adds an `ADJP`
inside the `NP` in sentence 2, under a grammar with explicit adjective phrases.
Under a flat nominal group, the adjective attaches directly to the `NP`.
The Penn Treebank convention uses this flat form (Marcus, Santorini, and
Marcinkiewicz, 1993).

The two formalisms differ in naming, not in substance. A dependency tree groups
the nominal phrase as a noun-rooted subtree. A constituency tree groups it as a
phrase node. The encoder can use the noun-rooted subtree, so the missing `NP`
node is not a loss.

## 6. Tree edit distance comparison

Tree edit distance (T.E.D.) counts the node operations that turn one tree into
another (Zhang and Shasha, 1989). The project compared the two sentences under
a unit-cost model. One insertion costs one. One deletion costs one. The nodes
carry grammatical labels only. Word forms are removed, in line with the syntax
vector.

| Tree | Sentence 1 nodes | Sentence 2 nodes | Distance |
| --- | --- | --- | --- |
| Dependency, labels `UPOS:DEPREL` | 5 | 7 | 2 |
| Constituency, flat nominal group | 9 | 11 | 2 |
| Constituency, explicit `ADJP` | 9 | 13 | 4 |

The node counts come from the trees in sections 3 to 5. The dependency node
labels are `DET:det`, `NOUN:nsubj`, `VERB:root`, `DET:det`, and `NOUN:obj` for
sentence 1. Sentence 2 adds two `ADJ:amod` nodes.

The result is important. Under the flat nominal group convention, the two
formalisms give the same distance. The reviewer's intuition holds. Under a
grammar with explicit `ADJP` nodes, the constituency distance grows, because
each adjective adds a phrase node and a word. The distance depends on the node
inventory and the cost model, not on the formalism alone.

The encoder will not use T.E.D. at query time. T.E.D. is expensive for long
trees. It also needs the query tree and the record tree together. The encoder
uses one fixed feature vector per tree and compares the vectors with cosine
similarity. T.E.D. serves here as a review tool only.

## 7. Decision

The project selects dependency trees in the CoNLL-U format. The reasons are:

1. The specification names dependency trees.
2. The parser candidates in the specification, UDPipe and Stanza, emit UD
   dependency trees. French constituency parsing is not available in the
   Bun and TypeScript path.
3. The required parser output in the specification maps to the CoNLL-U fields.
   The specification asks for "token positions, dependency heads, dependency
   labels, word classes, and available grammatical features."
4. Tree validation is simple. The code checks connectivity, roots, and cycles
   with the `HEAD` field.
5. The nominal group is recoverable as a noun-rooted subtree.

## 8. How the encoder will use the tree

The specification fixes the profile rules. The encoder will apply them to the
dependency tree:

- Remove `FORM` and `LEMMA`. Vocabulary must not enter the vector.
- Remove punctuation-only nodes.
- `coarse`: keep the edges, the `UPOS` classes, the relative order, and the
  base `DEPREL` labels. Remove `FEATS`.
- `detailed`: keep the same data. Also keep the allowlisted `FEATS`
  (`Definite`, `Gender`, `Mood`, `Number`, `Person`, `Tense`, `VerbForm`,
  `Voice`).

The specification requires connected features. It names "labeled edges, rooted
paths, and bounded subtrees." A bounded subtree rooted at a noun captures the
nominal group. The plan freezes the final feature families, the weights, the
vector dimensions, and the hash seed from test data set evaluation in Task 11.

## 9. Storage shape for a text with several sentences

A content field can hold more than one sentence. The slogan `Vous ici ? Pourquoi
pas ?` holds two sentences. The project must store and query the grammatical
forest of such a text.

Qdrant supports a **multivector**. A point stores a matrix of dense vectors
instead of one vector ([local mirror: vectors → Multivectors](../../docs/Qdrant%20-%201.19.1/documentation/manage-data/vectors/index.md)).
The matrix width is fixed. The number of rows can differ per point. The
`max_sim` comparator scores a query row against the best matching row of a
record. The score is the sum of the best matches.

The project stores the `syntax` vector as a multivector. One sentence is one
row. The project verified this shape on Qdrant `1.19.1`:

- A multivector collection with `max_sim` accepts a matrix of rows.
- An exact query returns the MaxSim score. Two identical matrices tie at `3.0`.
- The `has_id` filter and the `params.exact` flag work with the multivector.

A fixed-length limit applies. The Qdrant rule is `rows * size < 1,048,576`
([local mirror: vectors → Multivectors](../../docs/Qdrant%20-%201.19.1/documentation/manage-data/vectors/index.md)).
The project enforces this limit during validation.

### The raw `max_sim` score needs normalization

The Qdrant documentation defines `max_sim` as "a sum of maximum similarities
between each pair of vectors in the matrices"
([local mirror, line 160](../../docs/Qdrant%20-%201.19.1/documentation/manage-data/vectors/index.md)).
For matrices `A` and `B`:

```text
score = sum over i of max over j of sim(A[i], B[j])
```

The sum runs over the query rows. The score is therefore a sum, not an average.
The project measured this on Qdrant `1.19.1` with structural test vectors:

| Query rows | Record 1 row | Record 2 rows (both match) | Record 2 rows (one match) | Record 2 rows (no match) |
| --- | --- | --- | --- | --- |
| 1 row | 1.0 | 1.0 | 1.0 | 0.0002 |
| 2 rows | 2.0 | 2.0 | 2.0 | 0.0004 |

The measurement shows three facts:

1. Two query rows double the score. The raw score is not bounded by one.
2. A record matches itself at `2.0`, not at `1.0`, when it has two sentences.
3. A record receives a small nonzero floor from the row count alone, not from
   structural similarity.

The raw value cannot be a component score. A component score lies in `[0, 1]`.
The project uses a pairing rule:

```text
score = matchedTotal / max(queryRows, recordRows)
```

The rule pairs each query sentence with a **distinct** record sentence. The
matching is optimal, so one record sentence cannot satisfy two query sentences.
An unpaired sentence scores zero. The divisor then averages those zeros into the
result.

The user found the naive rule's defect. The raw sum reuses the best record row
for every query row, so a one-sentence record matched a two-sentence query at
`2.0 / 2 = 1.0`. That is wrong: a query sentence with no partner must score
zero. The project measured the corrected rule on the gold trees:

| Case | Reading | Score |
| --- | --- | --- |
| One sentence against itself | Exact self-match. | 1.0 |
| Two sentences against themselves | Exact self-match. | 1.0 |
| Two sentences against two, both match | Exact match. | 1.0 |
| Two sentences against one | The second query sentence is unpaired. | 0.5 |
| One sentence against two | The extra record sentence is unpaired. | 0.5 |

The rule is a project decision. The user approved the distinct-pairing rule at
Checkpoint B.

The function `multivectorSimilarity` in `src/lib/scoring.ts` implements the
rule. It uses `maximizeAssignment` (the Hungarian algorithm) for the optimal
pairing.

### Feature weights must depend on the grammatical role

The reference scorer counts every feature equally. A missing adverb costs the
same as a missing verb. The user identified this as a defect. A single negation
node dominated the score between two similar sentences. The project measured the
effect on the reviewed test data set.

The measure compares three weighting schemes:

- `flat`: every feature counts one. This is the current reference.
- `role`: each edge counts by its dependency label. Core roles (`root`,
  `nsubj`, `obj`) count `3.0`, `cop` counts `1.5`, `advcl` and `obl` count
  `2.0`, and modifiers (`advmod`, `det`, `expl`, `case`, `mark`, `cc`) count
  between `0.5` and `0.7`. An `UPOS` node counts `1.0`.
- `nodeboost`: like `role`, and each `UPOS` and `ROOT` feature counts `2.0`.

The scores for three sample queries:

| Pair | Reading | flat | role | nodeboost |
| --- | --- | --- | --- | --- |
| `x021` / `x019` | same negation and frame | 0.9081 | 0.8784 | 0.9041 |
| `x021` / `x020` | no negation, different complement | 0.8405 | 0.8675 | 0.8967 |
| `x021` / `x054` | shared adverbs only | 0.6498 | 0.6932 | 0.8236 |
| `x021` / `x001` | unrelated base tree | 0.0552 | 0.0377 | 0.0510 |
| `x012` / `x011` | shared frame and particle | 0.8895 | 0.9392 | 0.9221 |
| `x012` / `x001` | unrelated base tree | 0.6699 | 0.7181 | 0.7618 |

The `role` scheme changes the result in the intended direction:

1. The missing negation costs less. `x021` / `x020` rises from `0.8405` to
   `0.8675`, and it approaches `x019`, the true kin.
2. A real kin rises. `x012` / `x011` rises from `0.8895` to `0.9392`.
3. Unrelated trees stay at the floor. `x021` / `x001` stays near zero.

The measure also shows a risk. `role` raises `x012` / `x001` from `0.6699` to
`0.7181`. The scheme can compress the gap between a real kin and a base tree.
The final weights need the frozen evaluation in Task 11.

The user approved the direction at Checkpoint B. The exact weights stay open for
Task 11. The project must freeze them in a versioned encoder configuration
before it indexes the corpus.

### Transport quirks on Qdrant 1.19.1

The project found two transport quirks during the measurement:

1. A two-row matrix whose rows are unit basis vectors fails validation with
   `indices: must be unique`. The JSON parser reads the outer array as a sparse
   vector. A matrix with general float rows does not fail. The transport must
   send the multivector in an unambiguous form.
2. A multivector query needs one row per query sentence. The parser rejects two
   identical query rows with the same `must be unique` error. The query rows
   must differ, or the caller must send the query as a single matrix with a
   documented shape.

The project records both quirks for Task 6 and Task 12.

The alternatives were:

- One pooled vector per text. The project rejected it. A pooled vector cannot
  keep the sentence boundaries or the co-occurrence of two structures.
- One point per sentence. The project rejected it. It divides one record and
  complicates the complete-result and pagination contract.

The project records this decision in the specification, section 3.

## 10. Parser selection

Task 3 selects the parser that fills the trees. The project compared three
candidates on the reviewed test data set. The project selected
**`udpipe-wasm` with the `french-gsd` model**.

### Candidates and measurements

The project measured word-class accuracy (UPOS), governor accuracy (head), and
relation accuracy (label). The `french-gsd` and native UDPipe rows share one
model, so their accuracy is the same.

| Candidate | UPOS | Head | Label | Peak memory | Warm time |
| --- | --- | --- | --- | --- | --- |
| `udpipe-wasm` 0.1.0, UDPipe 1.3.1 | 95.1% | 81.8% | 80.8% | in-process | 5 to 13 ms |
| Native UDPipe 1.3.1 | same | same | same | 69 MB | about 3.7 ms |
| Stanza 1.15.0 | 96.8% | 91.0% | 87.5% | 1237 MB | about 82 ms |

Stanza is more accurate. It needs about 1.2 GB of memory and a Python process.
The project selected speed and a single Bun runtime, because the T0004 retrieval
path scores every record.

### Why the JavaScript and WebAssembly candidate wins

1. It runs inside Bun. It needs no Python process and no network.
2. It is about twenty times faster than Stanza.
3. It uses little memory.
4. Its accuracy on the test data set is good for short texts.
5. The underlying wasm emits the full CoNLL-U record, including `FEATS`. The npm
   wrapper drops `FEATS`, so the adapter reads the raw CoNLL-U output.

### Model alternatives

UDPipe ships four French models. The project compared them:

| Model | Source treebank | Treebank license | UPOS | Head | Head and label |
| --- | --- | --- | --- | --- | --- |
| `french-gsd` | UD_French-GSD | CC BY-SA 4.0 | 97.8% | 89.0% | 86.3% |
| `french-sequoia` | UD_French-Sequoia | LGPL-LR | 97.8% | 86.8% | 84.1% |
| `french-partut` | UD_French-ParTUT | CC BY-NC-SA 4.0 | 95.6% | 88.0% | 84.3% |
| `french-spoken` | UD_French-Spoken | (spoken) | 95.5% | 76.1% | 69.9% |

The project selected `french-gsd`. It has the best accuracy and a permissive
license.

### License

The UDPipe 2.5 download page labels all four models CC BY-NC-SA. That label is
outdated. The license follows the source treebank, and the treebanks changed:

- UD_French-GSD is CC BY-SA 4.0. Google dropped the non-commercial restriction
  on the annotations on 2019-11-15.
- UD_French-Sequoia is LGPL-LR.
- UD_French-PUD is CC BY-SA 3.0.
- UD_French-Rhapsodie and UD_French-ParisStories are CC BY-SA 4.0.
- UD_French-ParTUT stays CC BY-NC-SA 4.0.

The `udpipe-wasm` code is MPL-2.0. The UDPipe code is MPL-2.0. The
`french-gsd` model has no non-commercial restriction. The share-alike clause
still applies. The project must keep the model license and attribute the
treebank.

One risk stays open. The underlying sentences of UD_French-GSD come from web
text. Google asserts no ownership over them. Legal review is necessary before
commercial use.

### Model versions

- `udpipe-wasm`: `0.1.0`.
- UDPipe: `1.3.1`.
- Model: `french-gsd-ud-2.5-191206`.

## 11. Open questions

- The evaluation must show whether the dependency features reproduce the
  intuitive grouping. The tests in Task 1 and Task 11 decide this.
- The test data set uses the current French UD conventions. The parser uses the
  UD 2.5 model. The project records the label mapping. The known differences
  are `acl:relcl` against `advcl:cleft`, and `nsubj` against `expl:subj`.
- The project must mirror the `udpipe-wasm` and UDPipe documentation before
  adoption, as the specification requires.

## References

- [UD CoNLL-U format specification](https://universaldependencies.org/format.html)
- [UD syntax principles](https://universaldependencies.org/u/overview/syntax.html)
- Zhang, K., and Shasha, D. (1989). Simple fast algorithms for the editing
  distance between trees and related problems. *SIAM Journal on Computing*,
  18(6), 1245–1262.
- Marcus, M., Santorini, B., and Marcinkiewicz, M. (1993). Building a Large
  Annotated Corpus of English: The Penn Treebank. *Computational Linguistics*,
  19(2), 313–330.
- [udpipe-wasm package](https://github.com/exp-ouroborous/udpipe-wasm)
- [UDPipe project](https://github.com/ufal/udpipe)
- [UDPipe model page and accuracy table](https://ufal.mff.cuni.cz/udpipe/1/models)
- [UD_French-GSD treebank and license metadata](https://github.com/UniversalDependencies/UD_French-GSD)
- [Stanza project](https://github.com/stanfordnlp/stanza)
- `roadmap/T0004/parser-decision.md`
- The parser candidates and the local mirror rule are in
  `roadmap/T0004/spec.md`.

## Glossary

- **Adjacency list**: a tree form in which each node stores the index of its
  parent, instead of nested child lists.
- **CoNLL-U**: the plain-text file format that carries Universal Dependencies
  annotation as one line of ten fields per word.
- **Component score**: the normalized score of one index for one record. It lies
  in `[0, 1]`.
- **Constituency tree**: a syntax tree whose nodes group words into phrases,
  for example `NP` and `VP`. Also called a phrase-structure tree.
- **Dependency label**: the name of the grammatical relation between a word and
  its governor, for example `nsubj` or `obj`.
- **Dependency tree**: a syntax tree whose nodes are words. Each word points to
  one governor. The label on the link names the relation.
- **Edge**: the link between a word and its governor. The dependency label names
  the link.
- **Feature weight**: the multiplier that one feature contributes to the vector.
  A higher weight gives the feature more influence on the cosine score.
- **Governor**: the head word that another word depends on.
- **Head accuracy**: the share of words whose governor the parser identifies
  correctly.
- **License**: the legal terms that govern the use and the redistribution of a
  work.
- **MaxSim**: a comparator for multivectors. It sums, for each query row, the
  best match against the record rows. The raw value is not bounded by one.
- **Model**: the trained data file that a parser loads. The parser code and the
  model have separate licenses.
- **Modifier**: a dependent word that adds detail to its governor, for example an
  adverb, a determiner, or a preposition.
- **Morphological feature**: a grammatical detail of a word, for example
  `Tense=Pres` or `Gender=Fem`.
- **MPL-2.0**: the Mozilla Public License 2.0. A permissive license with a
  share-alike clause on modified files.
- **Multivector**: a matrix of dense vectors stored in one point. The matrix
  width is fixed and the row count can differ per point.
- **Multiword token**: one surface token that splits into several syntactic
  words, for example `au` into `à` and `le`.
- **Non-commercial (NC)**: a license clause that forbids commercial use.
- **Normalization**: a fixed transformation that converts a raw score into the
  documented range from zero to one. For a multivector, it divides the raw
  MaxSim sum by the larger sentence count on the two sides.
- **Phrase node**: a node in a constituency tree that groups words, for example
  `NP`.
- **Relation accuracy**: the share of words whose dependency label the parser
  identifies correctly.
- **Role**: the grammatical function of an edge, taken from its dependency
  label. A core role, such as subject or object, defines the frame. A modifier
  role, such as adverb or determiner, adds detail.
- **Root**: the one word with no governor. In CoNLL-U, its `HEAD` value is
  zero.
- **Share-alike (SA)**: a license clause that requires derived works to keep the
  same license.
- **Sparse vector**: a vector with few nonzero values. The JSON parser can read
  a multivector as a sparse vector by mistake.
- **Stanza**: a Python natural-language toolkit from Stanford University. It
  offers neural dependency parsing.
- **Subtree**: one node of a tree together with all of its descendants.
- **Tree edit distance (T.E.D.)**: the smallest number of node insertions,
  deletions, and relabelings that turn one tree into another.
- **UDPipe**: a trainable pipeline for tokenization, tagging, lemmatization, and
  dependency parsing.
- **Universal Dependencies (UD)**: a cross-language standard for dependency
  annotation and word classes.
- **UPOS**: the universal word-class tag of a word, for example `NOUN` or
  `VERB`.
- **Word class**: the grammatical category of a word, for example noun, verb,
  or determiner.
