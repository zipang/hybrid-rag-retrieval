# Scoring decision: bounded index scores and weighted combination

Ticket: `T0004` — related spec: `spec.md`, related plan: `plan.md`

Status: formulas frozen for Checkpoint B. The caller defaults need user
confirmation.

## Objective

Task 4 defines the typed contracts and the scoring functions for weighted
threshold retrieval. The contracts separate index weights, component scores,
combined scores, index generations, and result pages. This document records the
chosen formulas, their parameters, and the caller defaults.

## Contracts

The module `src/lib/retrieval-contract.ts` defines the types:

- `IndexName`: the names `syntax`, `semantic`, and `keyword`.
- `IndexWeights`: fractional contribution weights, one entry per selected index.
- `IndexScores`: finite component scores in `[0, 1]`, one entry per selected
  index.
- `WeightedQuery`: the text, the weights, the minimum score, the page size, the
  cursor, the filters, and the generation.
- `WeightedHit`: one scored record with its combined score and component scores.
- `WeightedResultPage`: the results, the next cursor, and the scoring metadata.

The separation matters. A weight is an input. A component score is an
intermediate value. A combined score is the public matching score. A generation
binds a score to one corpus and one scoring configuration.

## Normalization formulas

All formulas live in `src/lib/scoring.ts`. The version is
`NORMALIZATION_VERSION = "1"`. Bump the version when a formula or a parameter
changes.

### Dense indexes: `semantic` and `syntax`

The transformation is `max(0, min(1, cosine))`. A negative cosine value becomes
zero. A positive cosine value is preserved. A value above one is clipped to one.

### Keyword index: `keyword`

The transformation is `raw / (raw + scale)`. The scale is `BM25_SCALE = 3`. A
nonnegative raw score maps into `[0, 1)`. A raw score of zero or a negative raw
score maps to zero.

The function is monotonic and never reaches one. This keeps a very large raw
score from saturating the combined score.

### Scale evaluation

The project measured raw BM25 scores from Qdrant `1.19.1` on a three-record
probe collection of short French slogans. The query terms were common single
terms, partial slogans, and full slogans.

| Raw score | Meaning | `raw / (raw + 3)` |
| --- | --- | --- |
| 0.78 | one common term | 0.21 |
| 1.56 | two common terms | 0.34 |
| 3.27 | a partial slogan | 0.52 |
| 4.95 | a full slogan | 0.62 |

A scale of three spreads the observed range across `[0.2, 0.65]`. A smaller
scale pushes single terms too high. A larger scale squashes full matches too
low. The project freezes `scale = 3`.

The scale depends on the average slogan length. The project must revalidate it
after the corpus changes size or language. A change requires a version bump.

## Weight validation

`validateWeights` enforces the contract for `IndexWeights`:

- At least one weight is positive.
- Every present weight is a nonnegative finite number.
- No unknown index name is present.
- The sum is `1` within `WEIGHT_TOLERANCE = 1e-9`.

The function returns a typed result. It never silently normalizes invalid
weights. The API handler maps an invalid result to HTTP 400.

An absent index and a zero-weight index both contribute zero. Both trigger no
query embedding and no parsing for that index.

## Combination and threshold

The combined score is:

```text
combinedScore = sum(weight[index] * normalizedScore[index])
```

`combineScores` computes the sum over the selected indexes. A missing component
score contributes zero. A nonfinite component value contributes zero. The
result is clipped into `[0, 1]`.

`meetsThreshold` applies the inclusive threshold. The comparison is
`combinedScore >= minScore - SCORE_TOLERANCE`. A record with
`combinedScore === minScore` qualifies. At `minScore = 0`, a zero-score record
qualifies.

## Ordering

`scoreAndOrder` orders records by combined score descending. It breaks ties by
the point identifier ascending. The identifier comparison is total and stable:

- two numbers compare by value.
- two strings compare by code-unit order.
- a number sorts before a string.

The order does not depend on page contents or candidate-batch size.

## Finite-value policy

- A nonfinite component score becomes zero.
- A nonfinite weight fails validation.
- A nonfinite combined score fails the threshold test.
- The functions never produce `NaN` or `Infinity`.

## Syntax similarity reference tables

This section gives the syntax similarity between one test sentence and every
reviewed test sentence. The similarity uses the `coarse` mode. The syntax
weight is `1`, so the table shows the raw syntax component score in `[0, 1]`.
Read this value as the syntax contribution to the combined score.

### Method

The encoder does not exist yet. Task 11 implements it. These tables use a
reference implementation of the `coarse` abstraction over the expected trees in
`src/lib/syntax/test-data/french.json`. The reference implementation follows the
specification:

- Keep the dependency connections, the word classes, the relative word order,
  and the base dependency labels.
- Remove vocabulary, lemmas, morphological features, and punctuation.
- Build the feature set from unary features (`UPOS`), binary features
  (`EDGE:<label>:<upos><-<direction><-<distance>`), and rooted-path features
  (`PATH:<label>>...`).
- Hash every feature into a fixed position and count occurrences.
- Compute the cosine similarity, then apply `max(0, min(1, cosine))`.

The similarity between one query text and one record uses the multivector rule
from the memo, section 9. Every sentence is one row. The rule pairs each query
sentence with a **distinct** record sentence, using the optimal assignment. An
unpaired sentence scores zero. The score divides the matched total by the larger
sentence count on the two sides:

```text
score = matchedTotal / max(queryRows, recordRows)
```

A perfect equal-length match scores one. A query with two sentences against a
record with one sentence scores `0.5` when the record sentence matches the first
query sentence. The function `multivectorSimilarity` in `src/lib/scoring.ts`
implements the rule. `scripts/evaluate-syntax.ts` uses it.

### Sample selection

`x001` and `x002` share one coarse tree, so their tables must be equal. They
prove the spec example, but they do not separate the modes. The tables use
three queries that do separate behavior:

- `x001` — the base one-clause tree.
- `x012` — "La voiture s'arrêta net devant la maison". It adds a verb particle,
  an oblique complement, and an expletive pronoun.
- `x021` — "Il n'est jamais trop tard pour bien faire". It adds negation, an
  impersonal subject, a copula, and an infinitive clause.

Every table includes the multi-sentence records `x050` and `x051`, so the reader
can judge the length rule.

### Table 1: query `x001` — "Le garçon regarde le soleil"

| Rank | Identifier | Score | Text |
| --- | --- | --- | --- |
| 1 | x001 | 1.0000 | Le garçon regarde le soleil |
| 2 | x002 | 1.0000 | Un chat mange une souris |
| 3 | x003 | 1.0000 | Le soleil regarde le garçon |
| 4 | x004 | 1.0000 | La fille admire la lune |
| 5 | x007 | 0.8586 | La petite fille posa sa main sur le chat |
| 6 | x008 | 0.8586 | La jeune femme posa son sac sur la table |
| 7 | x049 | 0.8239 | La fille chante et le garçon danse |
| 8 | x036 | 0.7646 | Ferme la porte |
| 9 | x037 | 0.7646 | Ouvre la fenêtre |
| 10 | x028 | 0.6999 | Une voiture rouge roule vite |
| 11 | x029 | 0.6999 | Un chien noir court vite |
| 12 | x048 | 0.6996 | Le chat noir dort et le chien blanc veille |
| 13 | x012 | 0.6699 | La voiture s'arrêta net devant la maison |
| 14 | x034 | 0.6668 | Dans la forêt, un loup marche |
| 15 | x035 | 0.6668 | Sur la colline, un berger chante |
| 16 | x038 | 0.6574 | Il veut manger une pomme |
| 17 | x039 | 0.6574 | Elle veut boire un café |
| 18 | x046 | 0.6255 | Quelle belle journée ! |
| 19 | x047 | 0.6255 | Quel beau paysage ! |
| 20 | x052 | 0.6255 | Le petit garçon |
| 21 | x053 | 0.6255 | La grande maison |
| 22 | x024 | 0.6219 | Le pain et le fromage |
| 23 | x025 | 0.6219 | Le sel et le poivre |
| 24 | x011 | 0.6134 | Le dernier métro s'arrêta net au terminus |
| 25 | x006 | 0.5934 | C'est la petite fille qui admirait la lune en chantant |
| 26 | x009 | 0.5828 | Le train arrive en gare en retard |
| 27 | x010 | 0.5828 | Le bateau arrive au port en avance |
| 28 | x005 | 0.5724 | C'est le gentil garçon qui regardait la lune en souriant |
| 29 | x044 | 0.5421 | La lettre a été écrite par Marie |
| 30 | x045 | 0.5421 | La lettre a été lue par Paul |
| 31 | x026 | 0.5217 | Le vieux monsieur avec un chapeau noir |
| 32 | x027 | 0.5217 | La vieille dame avec une robe bleue |
| 33 | x030 | 0.5129 | Trois enfants jouent dans le parc |
| 34 | x031 | 0.5129 | Trois chats dorment dans le jardin |
| 35 | x050 | 0.5000 | Le garçon regarde le soleil. Le chat mange une souris. |
| 36 | x051 | 0.5000 | La fille admire la lune. Le chien dort. |
| 37 | x023 | 0.4663 | Partir, c'est mourir un peu |
| 38 | x040 | 0.2392 | Je pense qu'il pleut |
| 39 | x041 | 0.2392 | Je crois qu'elle chante |
| 40 | x022 | 0.2229 | Voir, c'est croire |
| 41 | x042 | 0.2229 | En marchant, il chante |
| 42 | x043 | 0.2229 | En courant, elle rit |
| 43 | x032 | 0.1672 | Demain, nous partirons tôt |
| 44 | x033 | 0.1672 | Demain, elle partira tôt |
| 45 | x019 | 0.1521 | Il n'est jamais trop tôt pour un espresso |
| 46 | x018 | 0.1304 | C'est bien pire en le cachant |
| 47 | x017 | 0.1251 | C'est encore mieux en le disant |
| 48 | x020 | 0.0715 | Il est toujours trop tard pour se souvenir |
| 49 | x013 | 0.0602 | Janvier ! Janvier ! |
| 50 | x014 | 0.0602 | Février ! Février ! |
| 51 | x021 | 0.0552 | Il n'est jamais trop tard pour bien faire |
| 52 | x054 | 0.0538 | Toujours plus vite |
| 53 | x055 | 0.0538 | Souvent trop tard |
| 54 | x015 | 0.0426 | Vous ici ? Pourquoi pas ? |
| 55 | x016 | 0.0426 | Toi là ? Et alors ? |

### Table 2: query `x012` — "La voiture s'arrêta net devant la maison"

| Rank | Identifier | Score | Text |
| --- | --- | --- | --- |
| 1 | x012 | 1.0000 | La voiture s'arrêta net devant la maison |
| 2 | x011 | 0.8895 | Le dernier métro s'arrêta net au terminus |
| 3 | x007 | 0.8069 | La petite fille posa sa main sur le chat |
| 4 | x008 | 0.8069 | La jeune femme posa son sac sur la table |
| 5 | x009 | 0.7767 | Le train arrive en gare en retard |
| 6 | x010 | 0.7767 | Le bateau arrive au port en avance |
| 7 | x030 | 0.7606 | Trois enfants jouent dans le parc |
| 8 | x031 | 0.7606 | Trois chats dorment dans le jardin |
| 9 | x034 | 0.7252 | Dans la forêt, un loup marche |
| 10 | x035 | 0.7252 | Sur la colline, un berger chante |
| 11 | x028 | 0.6831 | Une voiture rouge roule vite |
| 12 | x029 | 0.6831 | Un chien noir court vite |
| 13 | x001 | 0.6699 | Le garçon regarde le soleil |
| 14 | x002 | 0.6699 | Un chat mange une souris |
| 15 | x003 | 0.6699 | Le soleil regarde le garçon |
| 16 | x004 | 0.6699 | La fille admire la lune |
| 17 | x049 | 0.6110 | La fille chante et le garçon danse |
| 18 | x026 | 0.5819 | Le vieux monsieur avec un chapeau noir |
| 19 | x027 | 0.5819 | La vieille dame avec une robe bleue |
| 20 | x036 | 0.5669 | Ferme la porte |
| 21 | x037 | 0.5669 | Ouvre la fenêtre |
| 22 | x044 | 0.5669 | La lettre a été écrite par Marie |
| 23 | x045 | 0.5669 | La lettre a été lue par Paul |
| 24 | x038 | 0.5500 | Il veut manger une pomme |
| 25 | x039 | 0.5500 | Elle veut boire un café |
| 26 | x024 | 0.5203 | Le pain et le fromage |
| 27 | x025 | 0.5203 | Le sel et le poivre |
| 28 | x048 | 0.5188 | Le chat noir dort et le chien blanc veille |
| 29 | x006 | 0.5080 | C'est la petite fille qui admirait la lune en chantant |
| 30 | x005 | 0.4899 | C'est le gentil garçon qui regardait la lune en souriant |
| 31 | x023 | 0.4648 | Partir, c'est mourir un peu |
| 32 | x046 | 0.4410 | Quelle belle journée ! |
| 33 | x047 | 0.4410 | Quel beau paysage ! |
| 34 | x052 | 0.4410 | Le petit garçon |
| 35 | x053 | 0.4410 | La grande maison |
| 36 | x019 | 0.3859 | Il n'est jamais trop tôt pour un espresso |
| 37 | x032 | 0.3536 | Demain, nous partirons tôt |
| 38 | x033 | 0.3536 | Demain, elle partira tôt |
| 39 | x040 | 0.3468 | Je pense qu'il pleut |
| 40 | x051 | 0.3465 | La fille admire la lune. Le chien dort. |
| 41 | x050 | 0.3349 | Le garçon regarde le soleil. Le chat mange une souris. |
| 42 | x020 | 0.3241 | Il est toujours trop tard pour se souvenir |
| 43 | x041 | 0.3035 | Je crois qu'elle chante |
| 44 | x042 | 0.3030 | En marchant, il chante |
| 45 | x043 | 0.3030 | En courant, elle rit |
| 46 | x017 | 0.3024 | C'est encore mieux en le disant |
| 47 | x018 | 0.2758 | C'est bien pire en le cachant |
| 48 | x021 | 0.2753 | Il n'est jamais trop tard pour bien faire |
| 49 | x022 | 0.2525 | Voir, c'est croire |
| 50 | x054 | 0.1952 | Toujours plus vite |
| 51 | x055 | 0.1952 | Souvent trop tard |
| 52 | x015 | 0.1157 | Vous ici ? Pourquoi pas ? |
| 53 | x016 | 0.1157 | Toi là ? Et alors ? |
| 54 | x013 | 0.0546 | Janvier ! Janvier ! |
| 55 | x014 | 0.0546 | Février ! Février ! |

### Table 3: query `x021` — "Il n'est jamais trop tard pour bien faire"

| Rank | Identifier | Score | Text |
| --- | --- | --- | --- |
| 1 | x021 | 1.0000 | Il n'est jamais trop tard pour bien faire |
| 2 | x019 | 0.9081 | Il n'est jamais trop tôt pour un espresso |
| 3 | x020 | 0.8405 | Il est toujours trop tard pour se souvenir |
| 4 | x054 | 0.6498 | Toujours plus vite |
| 5 | x055 | 0.6498 | Souvent trop tard |
| 6 | x032 | 0.5310 | Demain, nous partirons tôt |
| 7 | x033 | 0.5310 | Demain, elle partira tôt |
| 8 | x017 | 0.5298 | C'est encore mieux en le disant |
| 9 | x018 | 0.3867 | C'est bien pire en le cachant |
| 10 | x023 | 0.3850 | Partir, c'est mourir un peu |
| 11 | x006 | 0.3141 | C'est la petite fille qui admirait la lune en chantant |
| 12 | x028 | 0.3078 | Une voiture rouge roule vite |
| 13 | x029 | 0.3078 | Un chien noir court vite |
| 14 | x005 | 0.3030 | C'est le gentil garçon qui regardait la lune en souriant |
| 15 | x011 | 0.2857 | Le dernier métro s'arrêta net au terminus |
| 16 | x015 | 0.2810 | Vous ici ? Pourquoi pas ? |
| 17 | x012 | 0.2753 | La voiture s'arrêta net devant la maison |
| 18 | x042 | 0.2478 | En marchant, il chante |
| 19 | x043 | 0.2478 | En courant, elle rit |
| 20 | x022 | 0.2124 | Voir, c'est croire |
| 21 | x016 | 0.1893 | Toi là ? Et alors ? |
| 22 | x040 | 0.1823 | Je pense qu'il pleut |
| 23 | x041 | 0.1823 | Je crois qu'elle chante |
| 24 | x044 | 0.1325 | La lettre a été écrite par Marie |
| 25 | x045 | 0.1325 | La lettre a été lue par Paul |
| 26 | x038 | 0.1285 | Il veut manger une pomme |
| 27 | x039 | 0.1285 | Elle veut boire un café |
| 28 | x030 | 0.0889 | Trois enfants jouent dans le parc |
| 29 | x031 | 0.0889 | Trois chats dorment dans le jardin |
| 30 | x036 | 0.0883 | Ferme la porte |
| 31 | x037 | 0.0883 | Ouvre la fenêtre |
| 32 | x009 | 0.0871 | Le train arrive en gare en retard |
| 33 | x010 | 0.0871 | Le bateau arrive au port en avance |
| 34 | x034 | 0.0847 | Dans la forêt, un loup marche |
| 35 | x035 | 0.0847 | Sur la colline, un berger chante |
| 36 | x049 | 0.0714 | La fille chante et le garçon danse |
| 37 | x007 | 0.0606 | La petite fille posa sa main sur le chat |
| 38 | x008 | 0.0606 | La jeune femme posa son sac sur la table |
| 39 | x048 | 0.0606 | Le chat noir dort et le chien blanc veille |
| 40 | x001 | 0.0552 | Le garçon regarde le soleil |
| 41 | x002 | 0.0552 | Un chat mange une souris |
| 42 | x003 | 0.0552 | Le soleil regarde le garçon |
| 43 | x004 | 0.0552 | La fille admire la lune |
| 44 | x026 | 0.0510 | Le vieux monsieur avec un chapeau noir |
| 45 | x027 | 0.0510 | La vieille dame avec une robe bleue |
| 46 | x046 | 0.0442 | Quelle belle journée ! |
| 47 | x047 | 0.0442 | Quel beau paysage ! |
| 48 | x051 | 0.0442 | La fille admire la lune. Le chien dort. |
| 49 | x052 | 0.0442 | Le petit garçon |
| 50 | x053 | 0.0442 | La grande maison |
| 51 | x013 | 0.0382 | Janvier ! Janvier ! |
| 52 | x014 | 0.0382 | Février ! Février ! |
| 53 | x024 | 0.0304 | Le pain et le fromage |
| 54 | x025 | 0.0304 | Le sel et le poivre |
| 55 | x050 | 0.0276 | Le garçon regarde le soleil. Le chat mange une souris. |

### Reading of the tables

**The length rule works.** In Table 1, the two-sentence records `x050` and
`x051` now score `0.5000`, not `1.0000`. The previous reference divided only by
the query length and hid this. The user identified the defect. The corrected
rule divides by the larger sentence count on the two sides.

**Table 1 keeps the spec example.** `x001`, `x002`, `x003`, and `x004` share
one coarse tree and score `1.0000`. The specification expects this.

**Defect to review.** `x003` reverses the subject and the object of `x001`. It
still scores `1.0000`, because the coarse mode removes lexical identity. The
project must decide whether the encoder needs an argument-order feature. This is
a Checkpoint E question.

**Table 2 separates behavior.** Query `x012` ranks `x011` first at `0.8895`.
Both share the particle `net`, the same main verb frame, and a place
complement. The base trees `x001` to `x004` fall to `0.6699`. The oblique
complement and the expletive separate the groups. This is the intended behavior.

**Table 3 strongly separates behavior.** Query `x021` ranks `x019` at `0.9081`
and `x020` at `0.8405` first. The three texts share the impersonal `il`, the
negation, the copula, and the adjective chain `trop` plus `tard` or `tôt`. The
base trees `x001` to `x004` fall to `0.0552`. The shared frame dominates. This
is the strongest separation of the three tables.

**The two-sentence records rank low in every table.** In Table 1 `x050` and
`x051` score `0.5000`. In Table 2 they score `0.3349` and `0.3465`. In Table 3
they score `0.0276` and `0.0442`. The lower score shows the length penalty. The
reader should judge whether the penalty is too strong for a genuine partial
match. Note that Table 3 gives the penalty its largest effect, because a
two-sentence record rarely shares the full `il` frame.

**Cross-table checks.** `x012` and `x021` score each other at `0.2753`. Table 2
ranks `x021` 48th, and Table 3 ranks `x012` 17th. The two trees differ, and the
scores agree.

## Weighted combined score examples

The tables above show the syntax component alone, at weight `1`. The following
example combines three indexes for query `x001` with the proposed chat-tool
weights `{ syntax: 0.5, semantic: 0.3, keyword: 0.2 }`. The semantic and keyword
values are placeholders, because those indexes are not measured here.

| Record | Syntax | Semantic | Keyword | Combined |
| --- | --- | --- | --- | --- |
| x001 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| x050 | 0.5000 | 0.9500 | 0.9000 | 0.7150 |
| x003 | 1.0000 | 0.9000 | 0.7000 | 0.9100 |
| x012 | 0.6699 | 0.4000 | 0.3000 | 0.5150 |

The combined score is `sum(weight * component)`. The example shows one point:
the length penalty on `x050` lowers its combined score below `x003`, even when
its dense and keyword scores are higher. The reader must decide whether this
matches the intent.

## Caller defaults

The project proposes these defaults for the API migration. The user must
confirm them at Checkpoint B.

| Caller | Proposed weights | Proposed `minScore` | Proposed `pageSize` |
| --- | --- | --- | --- |
| Chat retrieval tool | `{ semantic: 0.7, keyword: 0.3 }` | 0.5 | 10 |
| Retrieval panel | `{ semantic: 0.6, keyword: 0.4 }` | 0.5 | 20 |
| Smoke retrieval | `{ semantic: 0.5, keyword: 0.5 }` | 0.5 | 10 |

The existing hybrid path fuses dense and BM25 with RRF and a default `topK` of
five. The new path replaces the fused rank with weighted component scores. The
defaults above reproduce the current bias toward semantic matching, with a
meaningful keyword contribution.

Syntax weights stay absent until the syntax index is ready. A request that does
not select syntax must work without a parser.

## Open items for Checkpoint B

- Confirm the caller defaults in the table above.
- Confirm `BM25_SCALE = 3` after the real corpus statistics exist.
- Confirm the syntax default weight for the first combined retrieval release.
- Confirm the multivector rule: pair each query sentence with a distinct record
  sentence, score an unpaired sentence as zero, divide by
  `max(queryRows, recordRows)`. The user approved this rule at Checkpoint B.
- Argument order: resolved. A subject-object reversal scores `1.0000`, and that
  is correct. The coarse mode compares the tree shape alone, so the two
  sentences share one tree. The test data set now marks that pair `equal`.
- Feature weights are frozen in the encoder configuration
  (`DEFAULT_ENCODER_CONFIG` in `src/lib/syntax/encoder.ts`). The role weights
  make a core role count more than a modifier.
- The reference scorer is now `scripts/evaluate-syntax.ts`. It runs the encoder
  against the reviewed test data set.

## References

- `src/lib/scoring.ts`
- `src/lib/scoring.test.ts`
- `src/lib/retrieval-contract.ts`
- `roadmap/T0004/retrieval-feasibility.md`
- `roadmap/T0004/spec.md`
- `memos/syntax-trees.md`, section 9
- [Local Qdrant multivectors](../../docs/Qdrant%20-%201.19.1/documentation/manage-data/vectors/index.md)

## Glossary

- **Combined score**: the weighted sum of the selected component scores. It is
  the public matching score.
- **Component score**: the normalized score of one index for one record. It lies
  in `[0, 1]`.
- **Index generation**: a version of corpus data and scoring configuration used
  consistently for one paginated query.
- **MaxSim**: the Qdrant comparator for a multivector. It sums, over the query
  rows, the best match against the record rows.
- **Multivector**: a matrix of dense vectors stored in one point. One sentence is
  one row.
- **Normalization**: a fixed transformation that converts an index score into
  the documented range from zero to one.
- **Scale**: the positive BM25 parameter in `raw / (raw + scale)`. It sets the
  raw score that maps to one half.
- **Threshold**: the minimum combined score that a record must meet to qualify.
- **Tolerance**: a small numerical allowance for floating-point comparison.
- **Weight**: the fractional contribution of one index to the combined score.
