# Builder-reviewer alignment

Use this reference before Preflight, Prototype, Repair, Review, and Submit. It is the head-to-head contract between what
the builder must produce and what launch-admission review may demand. The normative verdict remains
[approval-criteria.md](approval-criteria.md).

## Symmetry rule

1. No review gate may be enforced unless the skill tells the builder how to satisfy it or how to prove it inapplicable.
2. No builder obligation may disappear during review. Builder, template, evidence, reviewer reproduction, and later
   checker must use the same property meaning and stable gate id.
3. `not-applicable-with-reason` requires structural, reachability, schema, or source proof. It is not a convenience label.
4. Alternative evidence is valid when it covers the same property with attributable scope and strength. A product name,
   scanner brand, framework, language, architecture, or upstream pattern is never the property itself.
5. Missing evidence means unproved. It does not prove the mechanism unsafe. A hard adverse finding requires a
   reproducible objective conflict: unauthorized value/power, insolvency, unbacked accounting, unintended lock, fee
   bypass, launch-integrity failure, or materially false executable/public behavior.
6. Risk tier changes review depth, monitoring, exposure limits, and professional-audit policy. It cannot create a pass,
   override a reproduced defect, or reject a category by name.
7. Interactive confirmation, one-prompt generation, manual authorship and generator brand are provenance facts, not
   security properties. Review the same exact artifacts identically. A material generated assumption remains unproved;
   an explicit implemented rule does not require a transcript.
8. Architecture selection may optimize capital, gas, latency, operations and review cost only after the declared outcome
   and protected properties are preserved. Efficiency cannot waive solvency, authorization or truthful scope.
9. Business-loop completeness checks that the implementation matches the promised user and value lifecycle. It does not
   make demand, growth, profitability, market size, token performance or economic attractiveness approval properties.

## Three separate judgments

| Judgment | Question | Owner and result |
| --- | --- | --- |
| Applicant technical integrity | Does the exact implementation match its declared rules and preserve triggered security properties? | A1-A11; applicant defects produce `CHANGES REQUIRED` |
| Current Programmable compatibility | Can the released schema, compiler, adapter, chain, UI/API, router, monitoring and execution path represent this exact sound design? | P1-P8; missing platform capability produces `PLATFORM PENDING` after A1-A11 pass |
| Product/legal eligibility | May Programmable offer this activity in the intended jurisdictions and product policy? | P9 human decision; pending eligibility is not a technical-unsafety finding |

Scientific experiments, games, wagering or prediction, transparent participant-funded redistribution, bonding curves,
RWA, privacy, AI agents, cross-chain systems, non-hook components, multi-token/multi-pool systems, and unknown future
concepts remain open. Review their triggered authority, value, solvency, truth/freshness, custody, failure, disclosure,
privacy, provider, and legal properties. Do not infer safety or danger from the label.

## Typed v1 review artifacts

Use the closed schemas below when their trigger applies. Validate them with
`scripts/typed-launch-contracts-v1-core.mjs`; they are applicant/agent review evidence and do not become Registry
acceptance or launch authority.

| Property | Contract |
| --- | --- |
| Supported/rejected direction and exactness matrix | `swap-mode-classification-v1.schema.json` |
| Delegated payer or sponsor intent | `delegated-payer-sponsor-intent-v1.schema.json` |
| Permit2 launch witness and replay boundaries | `permit2-launch-witness-v1.schema.json` |
| Lossless tool/test outcome and authorship | `test-evidence-outcome-v1.schema.json` |
| Scientific data and value influence | `scientific-data-evidence-profile-v1.schema.json` |
| RWA NAV, reserve, calendar, actions, redemption and insolvency | `rwa-evidence-profile-v1.schema.json` |
| A1-A11/P1-P9 assessment or maintainer-signed final verification | `launch-admission-decision-v1.schema.json` |
| Closed launch graph input and deterministic non-authoritative compilation | `launch-plan-graph-input-v1.schema.json` and `launch-plan-graph-output-v1.schema.json` |

An agent-prepared decision must keep its signed authority null and GitHub projection authority false. Only the separate
maintainer-signed record class may carry the typed signature, and even that record does not sign a wallet transaction,
broadcast a deployment, or prove Website activation.

## Gate crosswalk

| Gate | Builder must decide and build | Required artifact/evidence | Reviewer reproduces | Allowed alternative or N/A | Owner boundary |
| --- | --- | --- | --- | --- | --- |
| A1 Exact source/provenance | Freeze repositories, numeric ids, commits/trees, paths, dependencies, compiler/build, licenses, policy/package versions and proxy/admin identities | `submission.v2.json`, `application.v3.json`, dependency lock, review package, source/evidence hashes and exact-object retrieval | Anonymous identity/object resolution, clean dependency/build closure, byte and evidence binding, pre-result revalidation | Proprietary external dependency may omit vendor source only with exact operator/interface/version-or-observable-behavior/trust/failure evidence; immutable ref only where released source contract represents it | Applicant binds its sources; platform binds active package/policy; provider identity remains separate |
| A2 Executable implementation | Implement every applicant-controlled value/state/authority surface promised by the lifecycle | Source, build config, tests, executable entry points and generated artifacts | Clean-clone build and source-to-promised-behavior trace | Concept/interface/mock is N/A only for architecture review, never launch admission; proprietary external service follows A1 trust boundary | Applicant |
| A3 Complete launch plan | Encode targets, arguments, dependencies, CREATE2, pool/config, allocations, liquidity/custody, ordering, atomicity/rollback and postconditions without operator guessing | Exact public plan path/hash inside V3 source closure; when selected, closed Launch Graph V1 input/output; implementation/specification binding; mutation tests | Mutate every node/edge/argument/locator/identity/postcondition; recompile and rehearse the full lifecycle | The current V3 route may bind equivalent content-addressed applicant-source evidence. The Launch Graph six/seven setting is an explicit central submission profile, not permission to add `launch.json` to active V3. Missing profile integration is P1/P2 | Applicant supplies complete plan; missing platform module is P1/P2 only after plan is otherwise executable |
| A4 v4 auth/permissions/identity | Authenticate v4 callbacks, declare 14 flags/address bits, bind PoolManager/PoolKey and every mutually wired counterpart, define nested/self-call policy | Proposal, threat model, exact hook source/config, permission/address proof and focused tests | Wrong manager/pool/caller/counterpart, rebind/replay, address occupancy and callback ABI tests | No-hook or non-v4 surface marks callback properties N/A with reachability proof; current launch-profile incompatibility remains platform/product policy, not callback unsafety | Applicant |
| A5 Delta/settlement/liability | Define supported/rejected quadrant matrix, operation-specific ERC-20/native/take/settleFor/ERC-6909 paths, final payer/recipient and router/caller limits, backing and conservation | Accounting worksheet, settlement trace, value flows, stateful invariants, wallet/final-delta tests | Partial fills/signs/currencies, zero-sum plus asset delivery/refund ownership, valid zero-core-AMM custom accounting, invalid unbacked/no-op delta, and current-profile rejection of every `clear` | Non-swap design marks swap properties N/A. A zero core-AMM leg is permitted when complete final output is backed, delivered, conserved and user-limited | Applicant |
| A6 Programmable fee | For each canonical fee pool charge exactly 10 bps of executed gross quote volume on every successful supported mode, inclusive split, cumulative rounding, immutable owner-only claims and pool isolation | Root fee record, source/test paths, four-quadrant supported/rejected matrix, liability/events/reconciliation evidence | Floor/split, partial fill, aggregate-vs-split, unsupported-mode pre-movement rejection, final output, claims, bypass/self-call and alternative-pool isolation | Unsupported modes need not execute but cannot move value/state/liability or be exposed as bypass. Wider sound pool topology may wait on P1/P2; no substitute charge may be called compliant | Applicant implements declared canonical-pool fee; platform decides supported topology/adapter |
| A7 Custody/locks/admin | Give every asset/claim/position/backing amount an owner and enforceable terminal-state rule; bind canonical position; inventory admin/upgrade/rescue powers | Asset/value-flow/custody records, position identity, role matrix, decoy and exit tests | Decoy position, approvals/transfers/decrease/rescue, historic rights, dependency failure and intended terminal states | Time lock, maturity, dispute escrow, legal freeze, deliberate burn/forfeiture or permanent contribution may pass when explicit and authorized; permanence cannot trap deposits/claims/LP withdrawal/backing | Applicant technical controls; legal acceptability is P9 |
| A8 Liveness/bounds | Enforce every numeric/time/capacity bound and terminal/recovery rule; bound queues/loops/history | Code-to-spec table, boundary tests, ring-wrap/queue/keeper/failure evidence | Below/at/above, overflow-adjacent, repeated wraps, stale/reset/outage and recovery | Intentionally permanent terminal state is valid only under A7. No keeper/oracle/history surface means N/A with reachability proof | Applicant |
| A9 Triggered capabilities | Declare every surface/capability and apply scenario rows, including payer delegation, low-level operations, custom math, oracle/AI, game/wager, redistribution, RWA/privacy/cross-chain and unusual tokens | Surface/capability graph, threat model, schemas, source/tests and capability evidence | Attack the exact triggered trust/value/authority/failure property, not the category label | Unknown capability stays reviewable. Proprietary dependency, alternative language or unusual architecture may use equivalent attributable evidence; parser limitation is tooling/platform state | Applicant controls its mechanism; provider/product/legal/platform decisions remain separate |
| A10 Tests/analysis/evidence | Make every triggered property reproducible with truthful method outcomes, authorship, commands/versions, counts, artifacts and change impact | Test plan, gate status, evidence/tool matrix, clean-clone instructions and hashes | Reproduce semantic properties independently, verify scanner dispositions and invalidate changed inputs | A named tool may be unavailable if another attributable method covers the property. Fork/current-head is N/A when no live dependency/runtime assumption exists. Applicant evidence may pass while maintainer reproduction remains P8 | Applicant supplies reproducibility; maintainer independence and final attestation are P8 |
| A11 Spec/public claims | Keep code, numeric rules, docs, package, launch plan and visible claims consistent; bind licenses | Proposal/threat/test/evidence/public copy and code-to-spec matrix | Compare executable behavior, limits, custody/admin/economics and evidence scope to every claim | Economic attractiveness and provider/legal judgment are not truth claims. Disclosed unusual mechanics may pass; hidden behavior or guaranteed claims without backing fail | Applicant for accuracy/rights; provider and P9 for external decisions |

## Critical cross-gate properties

These properties intentionally span more than one gate and must appear in builder artifacts and review evidence.

### Delegated payer and allowance intent

An ERC-20 allowance authorizes the spender contract. It does not authorize any caller to select the payer, beneficiary,
launch, pool, or action. Default payer to the authenticated actor. A delegated payer requires payer-originated typed
authorization binding chain id, verifying contract, action, token, amount/max, beneficiary/recipient, complete launch or
configuration hash, target PoolKey/hook/router or equivalent identities, nonce, and deadline. Include Permit2, ERC-1271,
revocation, partial spend, residual allowance, refund ownership, front-running, replay, and every field mutation.

### Swap-mode applicability

Classify all four direction/exactness quadrants. Every supported successful mode must satisfy accounting, final-user, fee,
and evidence properties. Every unsupported mode must reject before value, state, liability, quote, router, quoter, or UI
behavior can create a bypass. The security policy does not force an architecture to expose every mode. A released product
adapter may still require a subset/superset; that is platform compatibility after the technical matrix passes.

### Custom accounting and final execution

Do not use “positive core-AMM leg” as a universal proxy for user safety. Require positive net trader output for a
successful output-producing operation, complete asset backing, conservation, correct signed/currency deltas, and final
combined hook-plus-AMM maximum-input/minimum-output/exactness/deadline/refund commitments. A fully backed RFQ, auction,
bonding curve, async, or other custom-accounting leg may supply all output. An unbacked or intentionally no-op returned
delta, fee at or above executed gross value, or current-profile use of `clear` fails.

### Terminal states, locks, and regulated restrictions

Every held asset has an enforceable terminal-state rule. Immediate exit is not universal: vesting, maturity, prediction
escrow, legal freeze, deliberate burn/forfeiture, and permanent scientific or liquidity mechanisms may be intentional.
Test authority, conditions, deadlines, liabilities, failure, and public description. A disclosed lawful freeze may block
transfer or execution while preserving the exact entitlement/accounting record under its declared process. Reject an
unintended/undisclosed lock, insolvency, or power that erases, redirects, or contradicts an existing entitlement.

### Evidence layers

Keep three levels distinct:

1. applicant builder evidence and clean reproducibility;
2. maintainer-controlled independent semantic reproduction or specialist review; and
3. external professional audit.

A10 requires level 1. P8 owns level 2. Level 3 follows explicit risk, TVL, custom-logic, and release policy. A tool brand,
test count, signature, upstream audit, or clean generated report cannot substitute for the property and exact scope.

## Later checker integration contract

The controlled implementation maintains one canonical normative-file manifest and must later add one closed semantic
property registry. Each semantic entry has: stable id, trigger,
builder obligation, artifact/schema fields, required evidence, allowed alternative/N-A proof, reviewer reproduction,
owner, severity, verdict effect, change-invalidation set, and positive/negative fixtures. Generate or validate templates,
approval output, and checker rules from that future registry. Until then, the versioned
`normative-property-manifest-v1.json` inventory and `policyBundleSha256` bind every canonical policy, authoring template,
blind-evaluation fixture, catalog, reference kernel, and enforcement implementation file. That content binding does not
by itself prove typed enforcement, semantic reproduction, acceptance, or launch authority.

The policy-bound blind-evaluation mirror contains prompt, rubric, suite, and provider-neutral runner definitions only.
Generated model responses, scores, caches, judge output, and run artifacts are evidence for one attributable run; they
are never normative inputs and must not enter the policy bundle.

Minimum blind fixtures:

- standard fee-hook launch with all four modes;
- exact-input-only game market with complete rejection of exact-output;
- fully backed zero-core-AMM custom curve/RFQ;
- sponsor-funded launch with Permit2 and a victim-standing-allowance attack;
- permissioned RWA pool with disclosed freeze/redemption rules;
- scientific signed score used display-only and then price-impacting;
- value-bearing prediction market with dispute/refund/payout solvency;
- transparent future-inflow-funded redistribution at zero new inflow;
- cross-chain reward/asset with duplicate, reorg, ordering, halt, and global-conservation cases; and
- tool outage with equivalent manual/property coverage versus property left genuinely unproved.
