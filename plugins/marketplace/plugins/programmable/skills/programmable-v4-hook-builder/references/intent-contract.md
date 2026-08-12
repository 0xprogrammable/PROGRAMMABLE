# Plain-language intent contract

Use this reference before selecting a starter, capability name, protocol mechanism, or implementation. The builder may
describe an idea in any language, with spelling mistakes, metaphors, examples, or no protocol vocabulary. Treat that
description as product intent, not as a schema exercise.

## Contents

- [Core invariant](#core-invariant)
- [Capture the idea](#capture-the-idea)
- [Ask only material questions](#ask-only-material-questions)
- [Write the intent contract](#write-the-intent-contract)
- [Translate meaning into architecture](#translate-meaning-into-architecture)
- [Prove no intent drift](#prove-no-intent-drift)
- [Redesign unsafe mechanisms](#redesign-unsafe-mechanisms)
- [Choose one outcome route](#choose-one-outcome-route)
- [Worked examples](#worked-examples)

## Core invariant

Never reject, narrow, or silently replace a legitimate product idea because the Builder lacks a template, category,
keyword, parser, provider integration, or familiar implementation. Unknown means custom architecture review, not
unsupported or unsafe.

Apply hard findings only to a concrete behavior: for example an unbacked payout, hidden control, unauthenticated value
movement, unrestricted drain, deliberate disclosure evasion, or an impossible accounting promise. Name the behavior,
not the product category. Preserve the intended user experience through a safer design whenever one exists.

## Capture the idea

Before archive discovery or starter selection:

1. Preserve the builder's original public-safe words verbatim. Do not normalize, translate, summarize, or correct this
   source statement in place. Before writing a GitHub artifact, stop and remove secrets, credentials, seed phrases,
   private keys, access tokens, or unnecessary personal data. Record only a public redaction marker and reason; never
   publish the sensitive value or a guessable hash of it.
2. Respond in the builder's language unless asked otherwise. A separate working translation may help technical work,
   but it never replaces the source statement.
3. Extract semantic facts from the full meaning and examples, not isolated words. Capture:
   - the experience people should have;
   - the actors and actions;
   - triggers and timing;
   - assets, rights, value sources, destinations, and custody;
   - pricing and supply behavior;
   - creator or administrator choices;
   - external facts or services that affect outcomes;
   - failure, exit, recovery, and retirement expectations; and
   - explicit non-goals or properties that must not change.
4. Mark every material fact as `confirmed`, `inferred`, `default-proposed`, or `unresolved`. Keep provenance back to the
   exact source sentence or later answer.
5. Preserve contradictions as unresolved choices. Do not resolve them by selecting the nearest standard launch.

Do not search the Registry to decide what the builder meant. Search only after the intent contract exists, then use the
result for comparison and reuse. A similar existing project cannot overwrite the new idea.

## Ask only material questions

Ask one plain-language question only when different answers would change at least one of:

- what users can do, receive, lose, redeem, or withdraw;
- the source or destination of money or assets;
- pricing, supply, fees, rewards, or execution guarantees;
- custody, control, mutability, upgrade, pause, or recovery power;
- dependence on a person, server, oracle, bridge, game result, or other external fact;
- failure, liveness, partial execution, settlement, or user exit; or
- whether the requested behavior is technically or mathematically achievable.

Offer two or three understandable choices, state their consequences, and identify a safe simple default when one does
not alter the core idea. If the builder delegated ordinary choices, take the reversible default and disclose it.

When the user asks to build or create, use Autopilot. Compile the working kernel and architecture alternatives before
asking anything. Continue through reversible local design and implementation with explicit defaults. Ask only when no
safe default preserves a missing fact about money, custody, authority, external trust, legal rights, or terminal
behavior. Do not fall back to a protocol questionnaire and do not treat generated prose or mocks as the missing fact.

Never ask the builder to choose callbacks, permission bits, deltas, PoolKey ordering, settlement calls, file layouts,
schema fields, contract patterns, or protocol vocabulary that follows from confirmed behavior. Never require the
builder to rephrase an idea with English technical keywords.

## Write the intent contract

Record this compact contract before committing to an architecture. Guided Explore shows it for confirmation; Autopilot
keeps it as the assumption ledger and proceeds when no material owner decision remains:

```text
Original idea
People and experience
Buy, sell, transfer, claim, or game behavior
Price formation
Supply changes
Value sources, destinations, and custody
Creator or administrator choices
External dependencies
Failure, exit, and recovery
Must preserve
Must not happen
Defaults taken
Unresolved product decisions
```

Use ordinary language. Omit inapplicable rows. Confirmation, when requested, accepts only the interpretation of the
product. It does not ask the builder to validate protocol choices, prove safety, or waive review. A direct correction
updates the contract; an explicit build request delegates safe reversible technical defaults, never an unstated
beneficiary, payout, custody, authority, provider, legal right, or terminal outcome.

Do not implement while a material contradiction or owner decision remains unresolved. Do continue autonomously when
only derived technical work remains.

## Translate meaning into architecture

Translate each confirmed semantic fact into structured capabilities, value flows, authorities, failure rules, tests,
and then protocol mechanisms. Apply these rules:

- Structured facts are authoritative. Prose keywords may help discover questions but may never switch a confirmed
  capability off, prove that it is absent, or create an adverse finding.
- Absence of a word is not evidence that behavior is unused. Set `used: false` only from an explicit denial or a
  complete confirmed design that logically excludes the behavior.
- A builder's own term remains valid. Add an owner-defined capability when no canonical id fits, preserve its stated
  semantics, and route it to architecture review.
- Select a template only after the semantic model is complete. A template may fill derived mechanics but may not
  supply, delete, or replace product intent.
- Derive Uniswap mechanisms from required behavior. Do not force a normal AMM, fixed supply, one familiar fee model,
  or any other default when the intent requires custom accounting, token behavior, services, or a new composition.
- Keep feasibility, safety, platform integration, provider support, and public availability as separate facts.

When confidence is insufficient, preserve the fact as unresolved or custom-reviewed. Never convert uncertainty into
`false`, unsupported, or unsafe merely to satisfy a closed profile.

## Prove no intent drift

Create a trace from every material contract statement to:

```text
intent statement -> structured fact -> architecture decision -> implementation location -> test/evidence
```

Run the trace after starter selection, schema generation, implementation, repair, migration, and any redesign. Stop
and repair the design when any material statement is:

- omitted;
- inverted;
- replaced by a convenient default;
- narrowed or broadened without confirmation;
- made dependent on a new trusted party;
- changed economically, including price, supply, fee, payout, or custody;
- changed on failure, exit, or recovery; or
- implemented but left without a corresponding test or evidence obligation.

The trace must compare semantics, not matching words. A translated sentence and Solidity identifier need not share any
token. Conversely, matching labels do not prove matching behavior.

Report drift in plain language: what the builder asked for, what the candidate does instead, why that matters, and the
smallest correction. Never describe a drifting implementation as conformant.

## Redesign unsafe mechanisms

Reject the unsafe mechanism, not the idea:

1. Quote or paraphrase the exact requested outcome to preserve.
2. Identify the concrete exploit, insolvency, hidden power, or impossible promise.
3. Separate that mechanism from the user-facing outcome.
4. Offer the closest design that preserves the outcome with bounded, visible trust.
5. Ask only if the safer alternatives materially differ for users or owners.
6. Re-run the intent-drift trace and disclose any unavoidable difference.

Do not claim that a redesign preserves the idea when it changes its essential economics or experience. If no funded,
conserved, authenticated, and technically feasible construction can satisfy a promise, explain that exact boundary and
offer the nearest honest version. This is a concrete redesign route, never a category-level ban.

## Choose one outcome route

While a material product choice remains unresolved, ask only that next question. Once intent is clear enough to select
a path, end the idea-stage result with exactly one primary route and a concrete next action:

| Route | Meaning | Next action |
| --- | --- | --- |
| `DIRECT_BUILD` | Confirmed intent fits a known composition without changing it. | Build the smallest complete design and prove the trace. |
| `CUSTOM_ARCHITECTURE` | The idea is feasible but needs a new mechanism or composition. Novelty is not adverse. | Preserve owner-defined capabilities and enter architecture review. |
| `INTEGRATION_PENDING` | The project can be designed or submitted, but Programmable runtime or a named external provider does not yet support a required surface. | Complete the project evidence and name the separate maintainer/provider integration gate. |
| `SAFE_REDESIGN` | A concrete requested mechanism is unsafe, unbacked, deceptive, or impossible as stated. | Present the closest safe construction, its differences, and the one material owner choice if needed. |

Choose the route for the immediate blocking path: safe redesign before integration, integration before implementation,
and custom architecture before a standard build. Record other non-blocking reviews and integrations separately rather
than inventing a fifth route.

Do not emit a generic `unsupported` outcome for novelty, missing automation, unknown tooling, language, lack of a
template, or absent provider support. Existing readiness and review states remain authoritative: the route explains the
next product path and does not invent approval, implementation, deployment, or availability.

## Worked examples

**Contract-priced burn:** “The contract decides the selling price and destroys every token sold back.” Preserve
contract price formation and sell-side burn as separate confirmed facts. Do not substitute an AMM price or fixed-supply
standard because the user did not say “custom accounting.” Ask only about the price formula or reserve source if it is
materially unresolved. Route to `CUSTOM_ARCHITECTURE` when no exact reusable composition fits.

**Game rewards:** “Players win part of the coin when they eliminate another player.” Ask who determines a valid result
only because that choice changes trust and cheating risk. The Three.js engine, signed server result, oracle, reward
vault, and hook permissions are derived technical choices. Missing platform game UI is `INTEGRATION_PENDING`, not an
unsafe game category.

**Unfunded promise:** “Every seller always receives twice what they paid, with no reserve or loss possible.” Preserve
the desired predictable sell experience, identify that an unfunded unconditional payout cannot remain solvent, and
offer a reserve-bounded or partial-fill design through `SAFE_REDESIGN`.
