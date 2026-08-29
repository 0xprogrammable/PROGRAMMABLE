# Protocol Assessment

## Implemented arithmetic

The Solidity library and SDK implement the unambiguous cumulative-floor
arithmetic over unsigned 128-bit values:

```text
A(B) = floor(B / 2,000)
assessment_delta = A(B_after) - A(B_before)
```

The implementation rejects cumulative-basis overflow and regression. Because
the calculation is cumulative, remainders carry across fills; assessing each
fill independently would produce different results and is not equivalent.

Example: a stored basis of 1,999 has assessment 0. Adding basis 1 produces
basis 2,000 and assessment delta 1.

## What arithmetic does not prove

A passing arithmetic result does not establish:

- which debits are applicable;
- the exact Principal/source authority for each debit;
- valid Refund causality and origin identity;
- grouping across Core, Constitution, Scope and Principal;
- funded Collector credit or matching liability;
- persisted replay/fill state; or
- a reconstructible assessment Receipt.

The library deliberately performs no token movement and stores no assessment
state.

## Blocking counterexample

For a gross debit of 100 and same-Fill return of 20, basis is 100 if the return
is an ordinary credit and 80 if it is a causal Refund. The protected-Effect
schema has no Refund Effect, refund ID or origin-debit reference, so the two
outcomes cannot be distinguished (`SPEC-GAP-001`).

The strict native implementation must not choose one outcome. Until the
portable Effect grammar is fixed and covered by vectors, no execution-layer
assessment, Collector debit, funded liability or conformance claim can be
completed.

## Review rule

Treat arithmetic tests as a narrow component result. A release claim needs the
complete exact Protocol grouping, classification, refund, funding, storage and
Receipt rules plus applicable vectors. Those prerequisites are absent at the
locked Draft.
