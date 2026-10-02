# Evaluation: French syntax test data set for T0004

Ticket: `T0004` — related spec: `spec.md`, related plan: `plan.md`

Status: for review. The test data set holds 55 texts, 30 ranking cases, and 21
structural pairs. The author annotated every tree by hand. A reviewer must
confirm the trees and the expected relations before the project tunes any
encoder weight.

Scope note: this ticket evaluates the `coarse` profile first. The test data set
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
  negative. The positive must score above the negative in each profile.
- A **structural pair** is two texts with one expected relation for one profile.
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
| `profileFeatures` | The morphological allowlist for the detailed profile. |
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
syntax profile per collection generation".

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

A `structuralPairs` entry declares one relation for one profile:

- `equal`: the two canonical trees must match. The encoder must produce the same
  vector.
- `different`: the two canonical trees must differ. The encoder must produce
  different vectors.

## Inventory

The test data set covers these structural families. Each family has two
hand-written texts, so a ranking case can pair them.

| Category | Texts | Grammatical feature under test |
| --- | --- | --- |
| vocabulary | `x001` `x002` `x004` | Same tree, different words |
| connection change | `x003` | Same words, different heads |
| relative clause | `x005` `x006` | Cleft, relative clause, gerund |
| passé simple | `x007` `x008` | Past tense, possessive, preposition |
| oblique | `x009` `x010` | Two prepositional phrases |
| reflexive | `x011` `x012` | Pronominal verb, adverb, preposition |
| interjection | `x013` `x014` | Two exclamative fragments |
| interrogative fragment | `x015` `x016` | Dislocated fragment, `Pourquoi pas ?` |
| comparative | `x017` `x018` | `encore mieux` / `bien pire` |
| negation-never | `x019` `x021` | `ne ... jamais`, impersonal `il` |
| adverb tard/tot | `x020` `x021` | `tard` versus `tôt` |
| infinitive subject | `x022` `x023` | `Voir, c'est croire`, comma |
| coordination nominal | `x024` `x025` | Two coordinated nouns, no verb |
| nominal PP | `x026` `x027` | Noun with a prepositional modifier |
| adjective and adverb | `x028` `x029` | Attributive adjective, adverb |
| numeral | `x030` `x031` | Number determiner, locative phrase |
| future | `x032` `x033` | Future tense, fronted adverb |
| fronted oblique | `x034` `x035` | Fronted prepositional phrase |
| imperative | `x036` `x037` | Imperative mood |
| infinitive complement | `x038` `x039` | `xcomp` with an infinitive |
| clausal complement | `x040` `x041` | `que` complement clause |
| gerund | `x042` `x043` | `en` + present participle |
| passive | `x044` `x045` | Passive voice, optional agent |
| exclamative | `x046` `x047` | `Quelle belle journée` |
| coordination clausal | `x048` `x049` | Two coordinated clauses |
| multiple sentences | `x050` `x051` | Sentence boundaries and a forest |
| interjection multi-sentence | `x013` `x015` | Repeated exclamation, two fragments |
| nominal fragment | `x052` `x053` | Verbless noun phrase |
| adverbial fragment | `x054` `x055` | Verbless adverb phrase |

The interjection texts `x013` and `x015` are multi-sentence. They test the
grammatical forest and the MaxSim multivector. The multiple-sentence texts
`x050` and `x051` test two full sentences.

The fragment texts test the specification rule that slogans often omit a
complete clause. The multiple-sentence texts test the grammatical forest and
the complete content field. The author removed several near-duplicate simple
texts to keep the set varied.

## Measurement

The evaluation reports these numbers for each profile:

1. Ranking accuracy: the share of ranking cases that rank the positive above
   the negative.
2. Structural accuracy: the share of structural pairs whose `equal` or
   `different` relation holds.
3. Parser accuracy: the share of tokens whose `upos`, `head`, and `deprel` match
   the gold annotation.
4. Parser failures: the texts that produce no valid tree.
5. Latency: parser start time, warm parse time, encode time, and query time.

The project fixes the judgments before it tunes the encoder weights. The
held-out list stays out of every tuning step.

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
- **Coarse profile**: the indexing profile that keeps connections and word
  classes, and removes morphological features.
- **Detailed profile**: the indexing profile that keeps the allowlisted
  morphological features.
- **Development item**: a test data set entry that parameter tuning may use.
- **Forest**: one or more grammatical trees for the sentences of one text.
- **Gold annotation**: the reviewed reference annotation for a sentence.
- **Governor**: the head word that another word depends on.
- **Held-out item**: a test data set entry that parameter tuning must not use.
- **Negative**: in a ranking case, the text with a different grammatical
  structure.
- **Positive**: in a ranking case, the text with the same grammatical structure
  and different words.
- **Ranking case**: a query text, a structural positive, and a structural
  negative for ranking evaluation.
- **Structural pair**: two texts with one expected relation for one profile.
- **Test data set**: the reviewed French material that the evaluation uses.
- **Test environment**: the isolated services and pinned parser and model that a
  test run uses.
- **Text**: one indexed content field, made of one or more sentences.
- **Token**: one word with its grammatical annotation.
