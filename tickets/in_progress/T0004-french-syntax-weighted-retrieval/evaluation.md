# Evaluation: French syntax test data set for T0004

Ticket: `T0004` — related spec: `spec.md`, related plan: `plan.md`

Status: for review. The test data set holds 55 texts, 30 ranking cases, and 21
structural pairs. The author annotated every tree by hand. A reviewer must
confirm the trees and the expected relations before the project tunes any
encoder weight.

Scope note: this ticket evaluates the `coarse` mode first. The test data set
still carries the feature allowlist and the detailed expectations, so the
deferred `detailed` evaluation needs no new data.

## Purpose

Task 1 of the plan requires a reviewed French evaluation set. The set judges the
syntax encoder and the parser. It also freezes the expected structural
relations.

## Vocabulary

The project uses precise names. One name has one meaning.

- A **test data set** is the reviewed French material in
  `src/lib/syntax/test-data/french.json`.
- A **test environment** is the isolated Qdrant collection and the pinned parser
  and model that a test run uses. Tests build the test environment from the test
  data set.
- A **text** is one indexed content field. It holds one or more sentences.
- A **sentence** is one grammatical tree. A text with two sentences holds a
  forest with two roots.
- A **ranking case** is a query text, a structural positive, and a structural
  negative. The positive must score above the negative in each mode.
- A **structural pair** is two texts with one expected relation for one mode.
- A **token** is one word with its grammatical annotation.

The specification calls a ranking case a "triplet". This document uses
"ranking case", because "triplet" does not name the grammatical role of each
member.

## Test data set schema

The test data set file is `src/lib/syntax/test-data/french.json`. It has these
keys:

| Key | Content |
| --- | --- |
| `version` | The test data set format version. |
| `language` | The language code, `fr`. |
| `tokenFields` | The token field order. |
| `modeFeatures` | The morphological allowlist for the detailed mode. |
| `texts` | The annotated texts. |
| `rankingCases` | The ranking cases. |
| `structuralPairs` | The controlled structural comparisons. |
| `split` | The development and the held-out identifier lists. |

### Tokens

A text holds a `sentences` array. Each sentence is an array of tokens. A token
is a tuple. The tuple order is:

The project stores the syntax vector as a multivector. Each sentence is one row
of the matrix. Qdrant `max_sim` scores a query row against the best matching row
of a record. See `memos/syntax-trees.md` and the plan section "Use one active
syntax mode per collection generation".

The tuple order is:

```
[ form, lemma, upos, head, deprel, feats ]
```

- `form`: the word as it appears.
- `lemma`: the dictionary form.
- `upos`: the Universal Dependencies word class.
- `head`: the 1-based token index of the governor. `0` marks a root.
- `deprel`: the Universal Dependencies relation to the governor.
- `feats`: the morphological features, joined by `|`. The field is absent when
  the token has no features.

The token index is the array position plus one. A sentence with two roots is a
forest. The project keeps the sentence boundaries, as the specification
requires.

The author wrote the annotations by hand from the Universal Dependencies
version 2 guidelines. No parser produced them. This rule keeps the parser
evaluation honest.

### Relations

A `structuralPairs` entry declares one relation for one mode:

- `equal`: the two texts produce the same syntax score of one. Only exactly
  isomorphic trees qualify.
- `different`: the two texts produce a score below one. Any structural
  difference makes the relation `different`.

The relation is binary. The project does not use a middle "similar" band,
because no review has established where such a band would start.

### Similarity rule

One text is a matrix of sentence vectors. The similarity pairs each query
sentence with a **distinct** record sentence, using the optimal assignment. An
unpaired sentence scores zero. The score divides the matched total by the larger
sentence count:

```text
score = matchedTotal / max(queryRows, recordRows)
```

A query with two sentences against a record with one sentence scores `0.5` when
the record sentence matches the first query sentence. The function
`multivectorSimilarity` in `src/lib/scoring.ts` implements the rule.

## Inventory

The test data set covers these structural families. Each family has two
hand-written texts, so a ranking case can pair them. The table names each text
by its own sentence.

| Category | Text | Grammatical feature under test |
| --- | --- | --- |
| vocabulary | Le garçon regarde le soleil | Same tree, different words |
| vocabulary | Un chat mange une souris | Same tree, different words |
| vocabulary | La fille admire la lune | Same tree, different words |
| connection change | Le soleil regarde le garçon | Same tree as the vocabulary texts |
| relative clause | C'est le gentil garçon qui regardait la lune en souriant | Cleft, relative clause, gerund |
| relative clause | C'est la petite fille qui admirait la lune en chantant | Cleft, relative clause, gerund |
| passé simple | La petite fille posa sa main sur le chat | Past tense, possessive, preposition |
| passé simple | La jeune femme posa son sac sur la table | Past tense, possessive, preposition |
| oblique | Le train arrive en gare en retard | Two prepositional phrases |
| oblique | Le bateau arrive au port en avance | Two prepositional phrases |
| reflexive | Le dernier métro s'arrêta net au terminus | Pronominal verb, adverb, preposition |
| reflexive | La voiture s'arrêta net devant la maison | Pronominal verb, adverb, preposition |
| interjection | Janvier ! Janvier ! | Exclamative fragment |
| interjection | Février ! Février ! | Exclamative fragment |
| interrogative fragment | Vous ici ? Pourquoi pas ? | Dislocated fragment, two sentences |
| interrogative fragment | Toi là ? Et alors ? | Dislocated fragment, two sentences |
| comparative | C'est encore mieux en le disant | `encore mieux` |
| comparative | C'est bien pire en le cachant | `bien pire` |
| negation-never | Il n'est jamais trop tôt pour un espresso | `ne ... jamais`, impersonal `il` |
| adverb tard/tot | Il est toujours trop tard pour se souvenir | `tard` |
| adverb tard/tot | Il n'est jamais trop tard pour bien faire | `tard`, `ne ... jamais` |
| infinitive subject | Voir, c'est croire | `Voir, c'est croire` |
| infinitive subject | Partir, c'est mourir un peu | Comma, infinitive subject |
| coordination nominal | Le pain et le fromage | Two coordinated nouns, no verb |
| coordination nominal | Le sel et le poivre | Two coordinated nouns, no verb |
| nominal PP | Le vieux monsieur avec un chapeau noir | Noun with a prepositional modifier |
| nominal PP | La vieille dame avec une robe bleue | Noun with a prepositional modifier |
| adjective and adverb | Une voiture rouge roule vite | Attributive adjective, adverb |
| adjective and adverb | Un chien noir court vite | Attributive adjective, adverb |
| numeral | Trois enfants jouent dans le parc | Number determiner, locative phrase |
| numeral | Trois chats dorment dans le jardin | Number determiner, locative phrase |
| future | Demain, nous partirons tôt | Future tense, fronted adverb |
| future | Demain, elle partira tôt | Future tense, fronted adverb |
| fronted oblique | Dans la forêt, un loup marche | Fronted prepositional phrase |
| fronted oblique | Sur la colline, un berger chante | Fronted prepositional phrase |
| imperative | Ferme la porte | Imperative mood |
| imperative | Ouvre la fenêtre | Imperative mood |
| infinitive complement | Il veut manger une pomme | `xcomp` with an infinitive |
| infinitive complement | Elle veut boire un café | `xcomp` with an infinitive |
| clausal complement | Je pense qu'il pleut | `que` complement clause |
| clausal complement | Je crois qu'elle chante | `que` complement clause |
| gerund | En marchant, il chante | `en` + present participle |
| gerund | En courant, elle rit | `en` + present participle |
| passive | La lettre a été écrite par Marie | Passive voice, optional agent |
| passive | La lettre a été lue par Paul | Passive voice, optional agent |
| exclamative | Quelle belle journée ! | `Quelle belle journée` |
| exclamative | Quel beau paysage ! | `Quel beau paysage` |
| coordination clausal | Le chat noir dort et le chien blanc veille | Two coordinated clauses |
| coordination clausal | La fille chante et le garçon danse | Two coordinated clauses |
| multiple sentences | Le garçon regarde le soleil. Le chat mange une souris. | Sentence boundaries and a forest |
| multiple sentences | La fille admire la lune. Le chien dort. | Sentence boundaries and a forest |
| nominal fragment | Le petit garçon | Verbless noun phrase |
| nominal fragment | La grande maison | Verbless noun phrase |
| adverbial fragment | Toujours plus vite | Verbless adverb phrase |
| adverbial fragment | Souvent trop tard | Verbless adverb phrase |

The multi-sentence texts test the grammatical forest and the multivector
similarity. The fragment texts test the specification rule that slogans often
omit a complete clause. The author removed several near-duplicate simple texts
to keep the set varied.

## Measurement

The evaluation reports these numbers for each mode:

1. Ranking accuracy: the share of ranking cases that rank the positive above
   the negative.
2. Structural accuracy: the share of structural pairs whose `equal` or
   `different` relation holds.
3. Parser accuracy: the share of tokens whose `upos`, `head`, and `deprel` match
   the expected annotation.
4. Parser failures: the texts that produce no valid tree.
5. Latency: parser start time, warm parse time, encode time, and query time.

The project fixes the judgments before it tunes the encoder weights. The
held-out list stays out of every tuning step.

The project reports the parser numbers separately from the encoder numbers. The
evaluation on the expected trees measures the encoder with the hand-made trees.
The parser evaluation measures the whole pipeline with the real model. A ranking
case that fails only in the parser run is a parser error, not an encoder error. The
project records the cause of each parser run failure before it judges the
encoder.

The coarse mode maps `PROPN` onto `NOUN`. The parser tags the same
interjection as `NOUN` in one sentence and `PROPN` in another. The map removes
that lexical difference, because it is not structural. See `spec.md`, "Word-class
normalization".

## Punctuation marks

An earlier rule removed every punctuation node. It also removed the statement,
question, and exclamation distinction, so `Il vient` and `Il vient ?` had one
tree. Task 11a measured the loss. Task 11b keeps punctuation in the tree and
weights the mark.

### Attachment

The parser attaches each mark to the head of the clause or phrase it belongs to,
following the UD `punct` rules. A probe on 15 French sentences confirmed the
rule: a terminal mark attaches to the root, a mark after a subordinate clause
attaches to that clause, a mark between coordinated units attaches to the
following conjunct, and paired marks attach to the same word. The project keeps
the parser governor and does not normalize it.

### Punctuation-only measurement

The evaluation derives its punctuation pairs from two reviewed texts, so the
set needs no extra text. It uses `Quelle belle journée !` for the terminal
marks and `Voir, c'est croire` for the internal comma. Every variant keeps the
same words and the same tree; only the punctuation changes.

| Pair | Marks removed | Marks kept |
| --- | --- | --- |
| no mark / `?` | 1.000000 | 0.781454 |
| no mark / `!` | 1.000000 | 0.781454 |
| `.` / `?` | 1.000000 | 0.966387 |
| no mark / `.` | 1.000000 | 0.781454 |
| comma kept / comma removed | 1.000000 | 0.977424 |

With the marks removed, every pair scored one. With the marks kept, every pair
with a different mark scores below one, and two texts with the same mark stay
identical. The encoder version changed from `coarse-2` to `coarse-3`. Run
`bun run scripts/evaluate-syntax.ts --mode coarse` to reproduce the numbers.

## Review protocol

The reviewer checks these points:

- The token boundaries, in particular the elisions (`C'`, `qu'`, `s'`).
- The `head` index of every token.
- The `deprel` label, in particular the subtypes (`advcl:cleft`, `expl:subj`,
  `nsubj:pass`, `aux:pass`).
- The morphological features, in particular `Tense=Imp` and `Tense=Past`.
- The expected relation of every structural pair.

### Convention-sensitive constructions

Two constructions have more than one documented UD analysis. The project aligned
them to the official French UD guidelines.

Clefts (`x005`, `x006`). The UD paper on nonprototypical predication states that
a cleft "treats the focus as the root of the clause, introduced by a copula verb
with an expletive subject and followed by the subordinate clause." French uses
the subtype `advcl:cleft`. The project therefore annotates `C'` as `expl`,
`est` as `cop`, the focused noun as `root`, and the relative-like clause as
`advcl:cleft`.

Impersonal `il` (`x019`, `x020`, `x021`, and the `pleut` clause in `x040`). The
French UD relations table lists `expl:subj` for the impersonal subject. The
project therefore annotates impersonal `il` as `expl:subj`. The negation words
`ne` and `jamais` are `ADV` with `Polarity=Neg`.

The parser selected in Task 3 may use plain `expl` or `acl:relcl` instead. The
project records the mapping at Checkpoint B. The two constructions stay in the
set for the ranking test.

## Open items

- The reviewer completes the check above.
- The project may add more connection-change cases.
- The project records the parser and model versions after Task 3.

## References

- `src/lib/syntax/test-data/french.json`
- `memos/syntax-trees.md`
- [UD CoNLL-U format specification](https://universaldependencies.org/format.html)
- [UD for French](https://universaldependencies.org/fr/index.html)
- [UD French relations table](https://universaldependencies.org/fr/dep/index.html)
- [Nonprototypical predication in UD (UDW 2026)](https://aclanthology.org/2026.udw-1.18.pdf)

## Glossary

- **Canonical tree**: a grammatical tree written in a consistent form, without
  vocabulary and without irrelevant annotation order.
- **Coarse mode**: the indexing mode that keeps connections and word
  classes, and removes morphological features.
- **Detailed mode**: the indexing mode that keeps the allowlisted
  morphological features.
- **Development item**: a test data set entry that parameter tuning may use.
- **Expected annotation**: the reviewed annotation of a sentence that the parser
  output and the encoder result must match.
- **Forest**: one or more grammatical trees for the sentences of one text.
- **Governor**: the head word that another word depends on.
- **Held-out item**: a test data set entry that parameter tuning must not use.
- **Negative**: in a ranking case, the text with a different grammatical
  structure.
- **Positive**: in a ranking case, the text with the same grammatical structure
  and different words.
- **Punctuation mark**: the symbol of a punctuation node, for example `?`, `!`,
  `.`, or `,`. The abstraction keeps it in the `punctuationMark` field, and the
  encoder weights it.
- **Ranking case**: a query text, a structural positive, and a structural
  negative for ranking evaluation.
- **Structural pair**: two texts with one expected relation for one mode.
- **Test data set**: the reviewed French material that the evaluation uses.
- **Test environment**: the isolated services and pinned parser and model that a
  test run uses.
- **Text**: one indexed content field, made of one or more sentences.
- **Token**: one word with its grammatical annotation.
