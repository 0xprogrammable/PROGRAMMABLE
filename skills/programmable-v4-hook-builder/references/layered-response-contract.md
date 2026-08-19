# Layered response contract

Use this contract whenever the Builder returns a design, implementation, review, application, status, or handoff result.
It keeps the builder-facing answer short without discarding the evidence needed by maintainers. The machine shape is
defined by `layered-response-v1.schema.json`.

## Two different layers

Produce both layers from the same facts:

1. **Builder response.** Lead with the practical state, ask at most one material owner decision, state the next action,
   disclose non-certifying limits, and point to artifact paths. Do not make a non-technical builder read raw JSON,
   callback names, permission bits, or an evidence ledger.
2. **Evidence artifact.** Preserve the complete intent facts, defaults, deferred decisions, architecture, findings,
   evidence, gate ledger, independent state lanes, and operations assumptions. A concise user response never authorizes
   deleting or weakening this detail.

The response and artifact must agree. When they differ, the more conservative evidenced artifact state controls and the
human response must be repaired.

## One decision at a time

Ask a question only when its answer changes user rights, value, custody, authority, trust, economics, failure, exit, or
technical feasibility.

- If no material choice blocks progress, ask no question and continue through reversible local work.
- If one or more material choices block progress, ask exactly the first dependency-changing choice. Give two or three
  plain-language options, consequences, and one recommended safe simple option.
- Put later material choices in the artifact's `deferredDecisions`; do not turn the builder response into a questionnaire.
- Do not ask for derived technical fields such as callbacks, permission bits, delta signs, schema keys, repository file
  layout, or protocol vocabulary.
- Ask in the builder's language. A decision question is the only builder-response field that may contain a question.

Confirmation accepts that one product decision only. It never accepts safety, waives evidence, or authorizes an
external action.

Autopilot is the default for a build or create request. It records safe reversible defaults and continues through local
work without requesting confirmation. It stops and asks the single question above only when no safe default preserves a
material owner fact. Interactive, one-prompt, manual and mixed-authorship projects use the same evidence and gate rules.

## Builder-response budget

The structured response budget is deliberately small:

- `outcome`: at most 45 whitespace-separated words;
- `status`: at most 35 words;
- `decision.question`: at most 30 words;
- each option label plus consequence: at most 30 words;
- `nextAction`: at most 35 words; and
- one to five artifact references.

Render these fields as natural prose rather than exposing the structure. If the result needs more explanation, write it
to the evidence artifact and link it. Safety-critical information is never hidden; compress it into the outcome/status
and retain the exact finding, effect, and repair path in the artifact.

## Non-certifying language

At proposal stage every response carries these five limits, expressed naturally for the builder:

- `DESIGN_NOT_APPROVAL`
- `LOCAL_CHECKS_NOT_AUDIT`
- `NOT_DEPLOYED`
- `PROVIDER_SUPPORT_UNRESOLVED`
- `NOT_PUBLICLY_AVAILABLE`

At later stages retain every limit that is still true. Remove one only from exact evidence for that independent state;
use `DEPLOYMENT_NOT_RUNTIME_VERIFIED` after deployment but before bytecode/configuration and lifecycle verification.
Design eligibility, structural validity, review, acceptance, deployment, runtime verification, provider integration, and
public availability never imply one another. Never call generated or locally checked work safe, secure, audited,
approved, verified, deployed, live, production-ready, or guaranteed.

## Artifact minimum

The artifact records:

- at least three intent facts with `confirmed`, `inferred`, `default-proposed`, or `unresolved` provenance;
- every deferred product decision in dependency order;
- each source, runtime, custody, authority, and data boundary in the architecture;
- findings with their effect and smallest repair or review path;
- evidence state and locator, including explicit `not-run` and `missing` entries;
- at least three independent gates with evidence references for every passed gate;
- separate design, implementation, application, runtime, and availability journeys; and
- operations assumptions for review queue, RBAC, audit logging, privacy, incident response, and monitoring.

At idea stage the operations assumptions are `DESIGN_ONLY`. This records requirements; it does not claim that an admin
service, reviewer queue, role enforcement, append-only log, privacy workflow, incident rotation, or monitoring system is
running.

## Independent state lanes

Track these lanes independently. A later state in one lane never advances another lane:

| Lane | Ordered states |
| --- | --- |
| Design | `IDEA_CAPTURED` -> `DESIGN_REVIEW_REQUIRED` / `DESIGN_CHANGES_REQUIRED` -> `DESIGN_READY` |
| Implementation | `NOT_STARTED` -> `IN_PROGRESS` -> `STRUCTURALLY_COMPLETE` |
| Application | `NOT_PREPARED` -> `PREPARED_NOT_SUBMITTED` -> `APPLIED_WAITING_REVIEW` -> `ACCEPTED` |
| Runtime | `NOT_DEPLOYED` -> `DEPLOYED_UNVERIFIED` -> `DEPLOYED_VERIFIED` |
| Availability | `NOT_AVAILABLE` -> `PROVIDER_PENDING` -> `AVAILABLE` -> `SUSPENDED` / `RETIRED` |

`DIRECT_BUILD`, `CUSTOM_ARCHITECTURE`, `INTEGRATION_PENDING`, and `SAFE_REDESIGN` are idea-stage routes, not approval or
runtime states. `STRUCTURALLY_COMPLETE` is not an audit. `APPLIED_WAITING_REVIEW` is not acceptance. `ACCEPTED` is not
deployment or launch. A deployed runtime is not provider support or public availability.

## Deterministic forward tests

`evals/forward-tests/manifest.json` binds static response-and-artifact fixtures for novice language, multi-repository
games, zero-scope services, unknown capabilities, safe redesign, and state journeys. The deterministic validator checks
the response budget, single-decision rule, non-certifying limits, artifact depth, operations boundary, fee scope, hard
conflict, and independent state histories without calling an external model. Passing those fixtures proves only that
the committed examples satisfy this response contract.
