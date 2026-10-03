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
| Universal Dependencies (UD) tree, CoNLL-U | Tree over words, typed relations | Selected |
| Constituency tree | Tree over phrases and words | Rejected |
| Word-class sequence | Flat list of word classes | Insufficient |
| Enhanced dependencies | Graph, not a tree | Out of scope |
| AMR (graph) | Graph of meaning | Out of scope |
| Source-code AST | Tree for code, not language | Rejected by the spec |

## 3. The UD representation

The [Universal Dependencies (UD) format](https://universaldependencies.org/format.html) defines the nodes annotation. 
The `CoNLL-U` file format carries it.
In the `CoNLL-U` file format, each word/token is represented with values in 10 fields:

```
ID  FORM  LEMMA  UPOS  XPOS  FEATS  HEAD  DEPREL  DEPS  MISC
```
1. `ID`: Word index, integer starting at 1 for each new sentence; may be a range for multiword tokens; may be a decimal number for empty nodes (decimal numbers can be lower than 1 but must be greater than 0).
2. `FORM`: Word form or punctuation symbol.
3. `LEMMA`: Lemma or stem of word form.
4. `UPOS`: Universal part-of-speech tag.
5. `XPOS`: Optional language-specific (or treebank-specific) part-of-speech / morphological tag; underscore if not available.
6. `FEATS`: List of morphological features from the universal feature inventory or from a defined language-specific extension; underscore if not available.
7. `HEAD`: Head of the current word, which is either a value of an existing `ID` or zero (0) for the sentence root.
8. `DEPREL`: Dependency relation to the `HEAD` (root iff `HEAD` = 0) or a defined language-specific subtype of one.
9. `DEPS`: Enhanced dependency graph in the form of a list of head-deprel pairs.
10. `MISC`: Any other annotation.

The `HEAD` field is the identifier of the governor. The `DEPREL` field is the
label of the relation to that governor. The UD syntax page states the central
fact: "The *basic* dependency representation forms a tree, where exactly only one
word is the head of the sentence, dependent on a notional ROOT, and all other
words are dependent on another word"
([UD syntax principles](https://universaldependencies.org/u/overview/syntax.html)).
`HEAD = 0` marks the root.

Each node stores the index of its parent. This is an adjacency list. It carries the full tree, but it does
not show the hierarchy as visual nesting.

The parser emits the full ten-field CoNLL-U record. The project keeps seven of
these values: the token `ID` and the six token fields `FORM`, `LEMMA`, `UPOS`,
`HEAD`, `DEPREL`, and `FEATS`. It drops `XPOS`, `DEPS`, and `MISC`. The parser
fills `XPOS` and `DEPS` with `_`, and the project does not use `MISC`.

The first example sentence, in the flat table that `show-syntax-tree` prints:

```
| ID | FORM    | LEMMA    | UPOS | HEAD | DEPREL | FEATS                                                 |
| -- | ------- | -------- | ---- | ---- | ------ | ----------------------------------------------------- |
| 1  | Le      | le       | DET  | 2    | det    | Definite=Def|Gender=Masc|Number=Sing|PronType=Art     |
| 2  | garçon  | garçon   | NOUN | 3    | nsubj  | Gender=Masc|Number=Sing                               |
| 3  | regarde | regarder | VERB | 0    | root   | Mood=Ind|Number=Sing|Person=3|Tense=Pres|VerbForm=Fin |
| 4  | le      | le       | DET  | 5    | det    | Definite=Def|Gender=Masc|Number=Sing|PronType=Art     |
| 5  | soleil  | soleil   | NOUN | 3    | obj    | Gender=Masc|Number=Sing                               |
```

The same sentence, in the indented tree that `show-syntax-tree` prints:

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

We choose the **Universal Dependencies (UD) trees** syntax in the `CoNLL-U` format. 
The reasons are:

1  Mainly availability and performances: french constituency parsing is not available in the
   Bun and TypeScript tooling ecosystem.
2. The UD syntax tree output conforms to the specification needs for "token positions, 
   dependency heads, dependency labels, word classes, and available grammatical features."
3. Tree validation is simple. The code checks connectivity, roots, and cycles
   with the `HEAD` field.

## 8. How the encoder will use the tree

- Remove `FORM` and `LEMMA`. Vocabulary must not enter the vector (it is semantic only).
- Keep punctuation-only nodes, in position and with the parser governor.

### Punctuation marks stay in the tree

An earlier rule removed every punctuation node. It also removed the statement,
question, and exclamation distinction, so `Il vient` and `Il vient ?` became one
tree.

The parser attaches each mark to the head of the clause or phrase it belongs to,
following the UD `punct` rules. A probe on 15 French sentences confirmed the
rule: a terminal mark attaches to the root, a mark after a subordinate clause
attaches to that clause, a mark between coordinated units attaches to the
following conjunct, and paired marks attach to the same word. The project keeps
the parser governor and does not normalize it.

The abstraction reads the token's `LEMMA`, which holds the mark (`?`, `!`, `.`,
`,`), into a `punctuationMark` field on the node. `FORM` and `LEMMA` are still
dropped for every other token, so a content word never leaks its vocabulary. A
mark is a closed symbol set, not open vocabulary.

The encoder gives the mark an explicit weight. Task 11a measured the loss before
the change. Two reviewed texts supply all the pairs, so the set needed no extra
text: `Quelle belle journée !` supplies the terminal marks and `Voir, c'est
croire` supplies the internal comma.

| Pair | Marks removed | Marks kept |
| --- | --- | --- |
| no mark / `?` | 1.000000 | 0.781454 |
| no mark / `!` | 1.000000 | 0.781454 |
| `.` / `?` | 1.000000 | 0.966387 |
| no mark / `.` | 1.000000 | 0.781454 |
| comma kept / comma removed | 1.000000 | 0.977424 |

Before the change every pair scored one. After the change every pair with a
different mark scores below one, and two texts with the same mark stay
identical. The encoder version moved from `coarse-2` to `coarse-3`.

The specification defined two modes : `coarse` and `detailed`. 
The encoder will apply them to the dependency tree:

- `coarse`: keep the edges, the `UPOS` classes, the relative order, the base
  `DEPREL` labels, and the punctuation marks. Remove `FEATS`.
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
zero. The project measured the corrected rule on the expected trees:

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
| "Il n'est jamais trop tard…" / "Il n'est jamais trop tôt…" | same negation and frame | 0.9081 | 0.8784 | 0.9041 |
| "Il n'est jamais trop tard…" / "Il est toujours trop tard…" | no negation, different complement | 0.8405 | 0.8675 | 0.8967 |
| "Il n'est jamais trop tard…" / "Toujours plus vite" | shared adverbs only | 0.6498 | 0.6932 | 0.8236 |
| "Il n'est jamais trop tard…" / "Le garçon regarde le soleil" | unrelated base tree | 0.0552 | 0.0377 | 0.0510 |
| "La voiture s'arrêta net…" / "Le dernier métro s'arrêta…" | shared frame and particle | 0.8895 | 0.9392 | 0.9221 |
| "La voiture s'arrêta net…" / "Le garçon regarde le soleil" | unrelated base tree | 0.6699 | 0.7181 | 0.7618 |

The `role` scheme changes the result in the intended direction:

1. The missing negation costs less. "Il n'est jamais trop tard…" / "Il est toujours trop tard…" rises from `0.8405` to
   `0.8675`, and it approaches "Il n'est jamais trop tôt…", the true kin.
2. A real kin rises. "La voiture s'arrêta net…" / "Le dernier métro s'arrêta…" rises from `0.8895` to `0.9392`.
3. Unrelated trees stay at the floor. "Il n'est jamais trop tard…" / "Le garçon regarde le soleil" stays near zero.

The measure also shows a risk. `role` raises "La voiture s'arrêta net…" / "Le garçon regarde le soleil" from `0.6699` to
`0.7181`. The scheme can compress the gap between a real kin and a base tree.
The final weights need the frozen evaluation in Task 11.

The user approved the direction at Checkpoint B. The exact weights stay open for
Task 11. The project must freeze them in a versioned encoder configuration
before it indexes the corpus.

### The coarse mode maps PROPN onto NOUN

The parser evaluation found a class of error that is not structural. It tagged
the same interjection as `NOUN` in one sentence and `PROPN` in another:

- "Janvier ! Janvier !" → `Janvier/NOUN`.
- "Février ! Février !" → `Février/PROPN`.

The two sentences have the same shape. They differ only in the word class that
the parser chose. The `NOUN` and `PROPN` classes are both nominal. The choice
between a common noun and a proper noun is a lexical property of the word. The
coarse mode exists to ignore lexical properties.

The coarse mode therefore maps `PROPN` onto `NOUN`. Two nominal words always
compare as one class. The detailed mode keeps the raw class.

The user approved the map at a Checkpoint E review. The function `canonicalUpos`
in `src/lib/syntax/abstraction.ts` applies it. The map raised the parser
structural accuracy from `82.4%` to `88.2%` and kept the accuracy on the
expected trees at `100%`.

The map is narrow. The project keeps the other classes as they are, because the
other parser disagreements are genuine tree errors. A fuller list is in
section 12.

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

## 12. Parser behavior and failure modes

The parser is `UDPipe 1.3.1` with the `french-gsd` model. The project measured
it on the reviewed test data set. The run parses every text and encodes the
result. The project recorded the failure cases and their cause.

### Accuracy

The parser run reports two kinds of number. The token accuracy measures the
parse against the expected trees. The task accuracy measures the encoder over the
parser trees.

| Measure | Expected trees | Parser trees |
| --- | --- | --- |
| Ranking accuracy | 100.0% | 79.3% |
| Structural accuracy | 100.0% | 88.2% |
| Token `UPOS` | — | 95.3% |
| Token `HEAD` | — | 82.8% |
| Token `DEPREL` | — | 80.8% |
| Failures | 0 | 0 |

The run on the expected trees measures the encoder alone. It reaches 100%. The
parser run measures the whole pipeline. It drops to about 80%. The difference is
parser quality, not encoder quality. The head accuracy of `82.8%` is the main
cause.

### Failure classes

The project grouped every failure by cause. Each class below gives the parser
output for the failing text.

**1. A wrong tree on a numeral sentence.** The parser built a different tree for
two sentences that must match:

- "Trois enfants jouent dans le parc" → `jouent/VERB/root`, `chats` is the
  subject.
- "Trois chats dorment dans le jardin" → `chats/NOUN/root`,
  `dorment/ADV/advmod`.

The second tree is wrong. The parser made the noun the root and tagged the verb
as an adverb. This is a genuine parser error. No feature change repairs it.

**2. A wrong subject on a fronted adverb.** The parser analyzed two future
sentences differently:

- "Demain, nous partirons tôt" → `Demain/PROPN/nsubj`, `nous/PRON/obj`.
- "Demain, elle partira tôt" → `Demain/ADV/advmod`, `elle/PRON/nsubj`.

The first tree is wrong. The parser made the fronted `Demain` the subject. The
second tree is correct.

**3. A wrong tag on a coordinated clause.**

- "Le chat noir dort et le chien blanc veille" → `dort/ADJ/amod`,
  `veille/VERB/root`.
- "La fille chante et le garçon danse" → `chante/ADJ/amod`, `danse/ADJ/amod`.

The parser tagged the finite verbs as adjectives. Both trees are wrong.

**4. A verbless sentence scored below one.** Two adverb fragments share one
shape, but the parser gave them slightly different features:

- "Toujours plus vite" and "Souvent trop tard" score `0.893`, not `1.0`.

The trees are the same shape. The small drop comes from a feature that the
coarse mode keeps.

### The corrected expected tree for the cleft pair

An earlier review recorded a fifth failure class for a cleft pair. The cause was
in the expected data, not in the parser. The expected tree of "C'est la petite
fille qui admirait la lune en chantant" was missing the token `petite`. The
partner sentence "C'est le gentil garçon qui regardait la lune en souriant" kept
its adjective. The two expected trees had 11 and 10 tokens, so they could never
be isomorphic.

The project added the token `petite` (`ADJ`, `amod` on `fille`) and shifted the
governor indices. The two expected trees are now isomorphic. The project changed
the relation of the pairs `p016` and `p017` from `different` to `equal`. Both
modes now score the pair at `1.0`, and the parser output already agreed with
the corrected tree. The failure class was a data defect, not a parser error.

### Label mapping

The parser uses the UD 2.5 label set. The expected trees use the current French
guidelines. The known label differences are:

- `acl:relcl` (parser) against `advcl:cleft` (expected) for clefts.
- `nsubj` and `expl:subj` for the impersonal subject.
- `obl:mod`, `obl` (parser) against `obl` (expected) for a modifier.

The coarse mode keeps the base label, so most of these differences vanish.
`acl:relcl` becomes `acl` and `advcl:cleft` becomes `advcl`, which still differ.

### Effect on the project

The encoder is validated on the expected trees at 100%. The parser adds noise. The
noise is acceptable for a proof of concept. The project records the parser error
rate. A future ticket can compare another parser or a better model.

The failed cases do not block the pipeline. They show which structures the
parser misses: numerals, fronted adverbs, coordinated verbs, and a few tag
choices.

## 13. Inspect a syntax tree from the command line

The tool `show-syntax-tree` prints the parse of one sentence. The source file is
`scripts/show-syntax-tree.ts`. The package script `show-syntax-tree` runs it.

```sh
bun run show-syntax-tree "Le garçon regarde le soleil"
```

The tool reads the model path from `UDPIPE_MODEL_PATH`. It falls back to
`models/french-gsd-ud-2.5-191206.udpipe`. The command `bun run init` downloads
that model. The tool loads the model once and parses one text.

The tool prints two views of each sentence:

- a **flat table**, one row per token, with the CoNLL-U fields `ID`, `FORM`,
  `LEMMA`, `UPOS`, `HEAD`, `DEPREL`, and `FEATS`;
- a **tree**, one line per token, with the governor above its dependents.

The flat table for the first example sentence:

```text
| ID | FORM    | LEMMA    | UPOS | HEAD | DEPREL | FEATS                                                 |
| -- | ------- | -------- | ---- | ---- | ------ | ----------------------------------------------------- |
| 1  | Le      | le       | DET  | 2    | det    | Definite=Def|Gender=Masc|Number=Sing|PronType=Art     |
| 2  | garçon  | garçon   | NOUN | 3    | nsubj  | Gender=Masc|Number=Sing                               |
| 3  | regarde | regarder | VERB | 0    | root   | Mood=Ind|Number=Sing|Person=3|Tense=Pres|VerbForm=Fin |
| 4  | le      | le       | DET  | 5    | det    | Definite=Def|Gender=Masc|Number=Sing|PronType=Art     |
| 5  | soleil  | soleil   | NOUN | 3    | obj    | Gender=Masc|Number=Sing                               |
```

The same sentence as a tree:

```text
regarde (VERB, root)
├── garçon (NOUN, nsubj)
│   └── Le (DET, det)
└── soleil (NOUN, obj)
    └── le (DET, det)
```

A node label has the form `FORM (UPOS, DEPREL)`. A root takes the `root` label
from the parser. The tree prints every sentence of a multi-sentence input in
reading order.

The tool uses the parser adapter from `src/lib/syntax/parser.ts`. The adapter
validates the parse, so the tool fails on a broken tree with
`ParseValidationError`, and on a missing model with `ParserUnavailableError`.

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
- **Common noun**: a word class for a general class of things, for example a
  "chat" or a "jardin". In UD its tag is `NOUN`.
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
- **Distinct pairing**: the rule that pairs each query sentence with its own
  record sentence. One record sentence cannot match two query sentences.
- **Edge**: the link between a word and its governor. The dependency label names
  the link.
- **Expected tree**: the hand-made syntax tree of one reviewed sentence. The
  parser must reproduce it, and the encoder uses it to check its output.
- **Feature weight**: the multiplier that one feature contributes to the vector.
  A higher weight gives the feature more influence on the cosine score.
- **Governor**: the head word that another word depends on.
- **Head accuracy**: the share of words whose governor the parser identifies
  correctly.
- **Hungarian algorithm**: a method that pairs two sets to maximize the total
  match. The project uses it to pair query sentences with record sentences.
- **License**: the legal terms that govern the use and the redistribution of a
  work.
- **MaxSim**: a comparator for multivectors. It sums, for each query row, the
  best match against the record rows. The raw value is not bounded by one.
- **Mode**: the syntax setting that chooses the grammatical detail in the syntax
  vector. The `coarse` mode keeps the structure only, and the `detailed` mode
  also keeps an allowlist of features.
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
- **Proper noun**: a word class for a named entity, for example a person or a
  month. In UD its tag is `PROPN`. The coarse mode maps it onto `NOUN`.
- **Punctuation mark**: the symbol of a punctuation node, for example `?`, `!`,
  `.`, or `,`. The abstraction keeps it in the `punctuationMark` field, and the
  encoder weights it. A mark is a closed symbol set, not vocabulary.
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
- **UPOS equivalence**: a rule that treats two word classes as one for a
  mode. The coarse mode treats `PROPN` and `NOUN` as one class.
- **UPOS**: the universal word-class tag of a word, for example `NOUN` or
  `VERB`.
- **Word class**: the grammatical category of a word, for example noun, verb,
  or determiner.
