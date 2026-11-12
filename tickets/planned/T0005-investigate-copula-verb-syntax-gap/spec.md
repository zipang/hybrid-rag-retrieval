# Spec: [T0005] Investigate the copula-versus-verb syntax gap

Ticket: `T0005` — investigation. Related context: `T0004`, memo
`memos/syntax-trees.md`, section 14.

- **Status**: planned
- **Depends on**: nothing (the coarse syntax encoder that T0004 delivered is
  available; T0004 is closed)

No implementation has started. This ticket produces evidence and a
recommendation, not production code.

## Objective

Decide whether the coarse syntax encoder must treat a copular clause and a
verbal clause with the same frame as close. If yes, choose the smallest rule
that reaches the intended score, and prove it on the reviewed data set.

The trigger is a measured surprise. Two sentences that differ only in the
predicate score far apart:

- `Dans son nouveau film, Christopher Lloyd est la pomme`
- `Dans son nouveau film, Christopher Lloyd mange la pomme`

The `coarse-3` syntax score is `0.248858`. The two trees differ on four facts at
once: the root token, the root class, the predicate role (`cop` against `root`),
and the governor chain. The memo `memos/syntax-trees.md`, section 14, records the
two trees and the four differences.

The scope is the French dependency pipeline of `T0004`: `parser.ts`,
`abstraction.ts`, and `encoder.ts`. The ticket does not change the retrieval
transport or the Qdrant contract.

## Why this ticket exists

The intuition says the two sentences share one "frame": a subject, a predicate,
and an object-like complement. The encoder does not share that view. The coarse
mode maps `PROPN` onto `NOUN` (memo section 8), so it already accepts one class
equivalence. The project asked whether a second equivalence, `AUX` onto `VERB`,
closes the gap. The memo shows it would not, because the class string is only one
of the four differences.

The correct fix is unclear. The parser is not obviously at fault: the UD
guidelines require the copula analysis. But the project has only one probe pair.
The decision needs a wider measurement, a comparison against the official UD
rules, and a check of the parser against the French treebank conventions.

## Questions to answer

1. Is the low score a general property, or one probe pair? Measure every copular
   clause in the reviewed data set against its nearest verbal kin.
2. Does the parser agree with the UD French guidelines on copular clauses? Check
   `french-gsd` output against the UD `cop` and `aux` pages and the French
   treebank documentation.
3. Which rule gives the intended grouping at the lowest cost?
   - A class map `AUX` onto `VERB` (the cheapest, likely insufficient).
   - Raising the predicate to the root during abstraction.
   - A shared feature for a copular and a verbal predicate.
4. Does a rule help the true kins without raising the score of unrelated trees?
   The section 8 memo already records this risk for the `role` weights.
5. Does the rule change the stored trees? If it does, the reviewed data set needs
   new expected trees. The project must weigh that cost.

## Hypothesis: weight tuning is a negative control

The project proposed one hypothesis to test and reject first. The hypothesis is
that a pure configuration change closes the gap: raise `VERB`, lower `AUX`,
adjust `cop` in `src/lib/syntax/encoder.ts`, and leave the tree as it is.

The project expects the hypothesis to fail. A weight scales how much mass a
feature adds to its bucket. A weight never changes the feature string. The two
trees only gain similarity where their feature strings coincide. Section 14 of
`memos/syntax-trees.md` lists the differing strings: `root:NOUN:*` against
`root:VERB:*`, `role:cop:AUX:*` against `root:VERB:*`, `node:NOUN:root:*`
against `node:NOUN:obj:*`, and every branch index. A weight change moves mass
inside buckets that do not overlap, so it only nudges the cosine.

This investigation must **measure** the hypothesis, not assume it. The reference
pair `Le garçon regarde le soleil` / `Un chat mange une souris` scores `1.0`
under the same weights, because their strings coincide. If weight tuning moves
the copula pair by only a few points, the hypothesis is rejected, and the
tree-level rules become the only path. The negative control is worth one
measured run.

## Method

The investigation uses the tools the project already has:

- `show-syntax-tree` to inspect the parser output on a copular sentence and on
  its verbal kin.
- `compare-syntax` to measure the score before and after a candidate rule.
- `evaluate-syntax` to measure the whole reviewed data set, so a rule cannot
  help one pair while hurting another.
- The reviewed data sets `test-data/french.jsonc` and
  `test-data/french-dataset.jsonc`, extended with copular and verbal pairs.
- The encoder configuration in `src/lib/syntax/encoder.ts`, for the weight
  negative control. A weight change bumps the configuration version.

The project writes the findings into a new memo or a new section of
`memos/syntax-trees.md`. Every number keeps its method and its version, as the
memos rules require.

## Out of scope

- The end-to-end path: parse, abstract, encode, store, retrieve. That path lands
  first. The memo section 14 records this order.
- The `detailed` mode.
- Replacing the parser. This ticket checks the parser, but the parser decision
  is `T0004`, section 10.

## Deliverables

1. A measurement of the copula gap over the reviewed data set, not one pair.
2. A statement, sourced from the official UD documentation, of what the parser
   must produce for a copular clause.
3. The measured result of the weight negative control, with the configuration
   version that produced it.
4. A ranked list of candidate rules, each with its measured effect on true kins
   and on unrelated trees.
5. A recommendation: adopt a rule, or accept the gap and record why.
6. A decision on the expected-tree impact, if the chosen rule changes the stored
   trees.

## Acceptance

- The report names every source, with the UD links and the local measurements.
- Every candidate rule has a measured score on the reviewed data set.
- The weight negative control has a measured score, not an assumption.
- The recommendation states its cost, including any data-set update.
- The user reviews the recommendation before any implementation ticket opens.

## Glossary

- **Coarse mode**: the syntax mode that keeps the structure only and drops the
  grammar features.
- **Copula**: a link word that joins a subject to a noun or an adjective, for
  example `est` in `il est content`. In UD its class is `AUX`, its role is `cop`.
- **Copular clause**: a clause whose predicate is a noun or an adjective, not a
  verb. The predicate, not the copula, is the root.
- **Frame**: the set of core roles that a clause needs, for example a subject
  and an object.
- **Kin**: a sentence that shares the grammatical shape of another sentence.
- **Negative control**: a candidate that the project expects to fail. The
  investigation measures it anyway, to prove that the failure is real and not an
  assumption.
- **Predicate**: the part of a clause that says something about the subject.
- **Syntax score**: the number from zero to one that compares two grammatical
  shapes.
