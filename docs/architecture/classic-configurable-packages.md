# Configurable Classic packages, templates and actions

Status: design requirements from the 5 September 2026 gap review of `001cba1635ca7b5e69c6ce4e3bba12d53e159a16`. No interfaces or runtime behavior in this document are implemented by publication of this specification. It extends the [open package architecture](classic-open-module-contract-v2.md).

## Concrete gaps in the current implementation

- `packages/classic-modules/src/index.mjs:122–177` accepts closed flat configuration objects and at most eight static ABI fields. The associated manifest schema permits only the fixed V1 type/profile set. It cannot generally express nested recipient schedules, conditional variants or semantic account roles.
- The manifest requires chain, implementation address and runtime hash even for the first validation step. Source contribution and later chain activation are not separate records yet.
- The SDK's split/CTO helpers do not supply a generic post-launch action model. A deployed ABI alone does not describe who may act, required funding or the resulting user state.
- `ClassicModuleFeeLedgerV1.replaceCreatorWallets` correctly rotates all future Creator payout slots under existing policy. Reusing those slots for an immutable module funding promise would make that promise administratively redirectable. This is an integration conflict in the proposed extension, not a defect in the existing CTO operation.

## Distinct records and binding phases

Keep source/package revision, chain-specific activation, reusable template, resolved launch recipe and running instance state distinct.

A template binds exact package versions, input definitions, defaults and unresolved account/component references. A resolved recipe binds the actual chain, admitted code, complete dependency/instance graph, initialization, configuration, rights, funding and connections. Running state includes counters, claims and action progress allowed by the immutable rules. Permitted state transitions must not imply permission to change the rules.

Classify values as fixed launch rules, evolving runtime state, explicitly controlled parameters, or external inputs. A future package may expose a controlled parameter only under a launch-bound policy declaring the role, scope, limits and effects of that change. This does not authorize changing previously fixed parameters or existing launches. Preserve the agreed Classic guarantees, including protected funds, fee rights and code bindings. A module-operator role and the Creator-payout CTO role are independent unless an explicitly admitted launch policy defines a compatible relationship.

Sharing or importing a template grants no authority and executes no contributor code. Resolve a symbolic launch-creator role from the actual launch authorization. Preserve a deliberately literal third-party recipient and clearly disclose it; do not silently retain another user's resolved creator wallet when reusing a role-based template. Defaults cannot replace registry-bound module authors or reward attribution. Re-resolve chain-sensitive assets and component references before preview and signing. Existing launches never follow a preset's latest version.

The full dependency graph must distinguish shared instances from separate instances of identical code. Their behavior is different and therefore their commitments must differ. Bind transitive dependencies, exact connections, initialization and externally controlled assumptions. No dependency may be silently resolved through a mutable `latest` pointer.

## Structured inputs and semantic references

The configuration model must support bounded records, lists, optional fields and tagged variants, with versioned semantic types and a deterministic codec. It must express declarative cross-field conditions such as sum-of-shares, start-before-end and aggregate budget constraints. Resource/depth/size bounds belong to an execution profile rather than to a permanent eight-field product rule.

Distinguish literal addresses, authenticated account roles, chain-qualified assets and component-instance references. Binding phase is part of the type: launch creator is resolved at launch, trade actor from a validated execution context, and a newly deployed vault from the committed component graph. An address receiving funds does not acquire execution or configuration authority. Ownership proof is required for the particular authority claimed, not indiscriminately for every payout recipient. Support suitable ordinary wallets, multisigs and smart accounts; signer, payer, caller and recipient are separate roles.

Amounts carry asset identity and raw-unit encoding; percentages name their denominator; time values name seconds or a specific block source. Reject ambiguous conversions and configuration that exceeds admitted bounds. Browser, API, CLI and chat use the same schemas, validation results and codec. Onchain enforcement independently checks financially material constraints and admitted code. Arbitrary JSON or executable validators in a privileged host are not a substitute for these semantics.

Public configuration contains no private keys or service credentials. External accounts and secrets use separately scoped service bindings without pretending that a public onchain value is private.

## Deterministic compilation and preview

Compile validated inputs and the admitted package graph into the exact components, deployment/initialization order, resolved references, assets, rights, budgets and execution order. One canonical codec produces the actual calldata and recipe commitment. A contributor may provide an approved versioned extension where new encoding is necessary; the host does not accept arbitrary code running with its wallet authority.

Preview, simulation and execution bind the same resolved plan. Simulation records chain and block and is a snapshot, not a future outcome guarantee. Runtime amount bounds, deadlines, current authorization revisions and replay protection cover the eventual operation. A changed wallet, network, package version, recipient or funding input invalidates the prepared plan until revalidated. The canonical receipt ties the result back to the expected launch and action.

## Financial sources, allocation and CTO scope

Before integrating a new engine, specify and prove its authenticated executed-quote basis, fixed 20-bps assessment, equal 10/10 platform/author allocation, Creator fee calculation, rounding and additional funding order. Balance-backed reported claims alone do not prove that an engine reported the correct fee basis. Verify every supported trade direction/exactness and route; users must not bypass the agreed fee through another public engine entrypoint. Transfers that merely realize existing claims are not automatically assessed as new swaps.

Every allocation names asset, owner, funding source, basis, lifecycle phase and the available amount. Aggregate all reservations for the resolved composition; three modules taking 40 percent of the same source consume 120 percent even when every pair is admissible. Funds cannot simultaneously back a free payout, an open obligation and another module's available budget. Conditional future receipts are not current backing. A fall in Creator fees reduces allocations funded from those fees according to the launch-bound rule; fixed obligations require the specific coverage policy to hold independently.

Separate platform/author entitlements, personal Creator payouts, irrevocably assigned module budgets and any additional contribution or prefunding. Contributors do not acquire an entitlement to spend other authors' fees. Claim routing alone is not executable working capital or a funded keeper job.

**Recommended rule for the new architecture, to be resolved before financial integration:** preserve CTO rotation for future personal Creator payouts and their payout splitters. Store launch-committed module funding assignments separately so ordinary CTO rotation cannot redirect them. Historical balances remain with their existing beneficiaries. Any permission to alter module financing would require its own explicit launch-time rule; it must not be introduced as a side effect of changing a wallet. This specification does not change current contract powers.

Illustrative accounting only: for 1,000 raw-normalized quote units executed and a chosen extra one-percent Creator fee, fixed fees are 1 platform + 1 author; Creator fees are 10. A disclosed 40/30/30 allocation of that Creator amount produces 4 module + 3 reinvestment + 3 personal payout. No new rate, asset conversion or payout policy is established by this example.

The no-module destination for the intended author bucket remains an unresolved release policy. Do not silently invent a destination or describe a zero-module revenue release as ready before it is bound.

## Post-launch actions and external work

Each package describes its reads and actions: instance, version, typed inputs/outputs, actor role, prerequisites, approvals, funding limits and meaningful state/result. The host can therefore offer new actions through a generic coin view without handwritten central integration for every contribution. Prepare, simulate, explain effects, authorize, execute and resolve the canonical outcome through the same path for UI/API/agent.

Automatic controls provide a fallback for essential state, financial actions and administration. They need not reproduce every custom game interaction or visualization. A custom surface that is essential to the promised behavior must be declared required and delivered before availability. Custom presentation runs in isolation, submits typed inputs/action intents to the host, and never gets a direct privileged wallet provider. The host validates, encodes and discloses the actual operation. The fixed recipe and control policy remain inspectable even when a custom UI or author service is unavailable.

An asynchronous job needs a specified caller, execution-cost source, available/reserved budget, request identifier, authenticated completion and bounded retries. Distinguish settlement-critical dependencies from later fulfillment. The recipe defines terminal handling for a genuine timeout: an enforceable refund or another explicitly agreed result. A generic timeout must never permit selecting a favorable random result after it becomes observable. Services/bridges have external assumptions; a pinned address does not guarantee delivery or remove external control.

Preserve accessible claims and agreed exit paths without a live Programmable frontend or author server. Catalogue deprecation affects future selection, not accrued entitlements or existing code. Do not add a hidden emergency upgrade or transfer of existing funds as an incident response. Optional failure handling may skip a component only where the admitted composition preserves all promised rights under that exact failure mode.

## Required website integration and documentation

A publicly available module ships its complete intended management experience with its contribution. An automatically operating module can declare that it needs no manual controls. Source acceptance and complete website/chain availability are distinct states. Contract review alone must not make an incompletely integrated module selectable for a new public launch.

The package's version-bound management description must include:

| Area | Required declaration |
| --- | --- |
| Configuration | Typed launch inputs, defaults, units, validation and role/component binding phases. |
| Reads and history | Actual source, chain/instance/asset binding, schema, freshness/finality, pagination and unavailable-data handling. |
| Actions and controls | Complete relevant operation inventory, inputs, target/function binding, effects, funding/approvals, preconditions and result states. |
| Roles and policy | Source of authority, scope, permitted changes, bounds and allowed role transfers. UI visibility never grants authority. |
| Presentation | Clear labels/help and public, personal or management placement; custom UI requirements where needed. Role names can be contributed and are not limited to these view groupings. |
| Host requirements | Required and optional versioned rendering, data, execution and integration capabilities. |
| Services and jobs | Operators, actual data use, scoped access, financing, dependencies, retry and terminal outcome. |
| Documentation and evidence | Setup/use/control/failure guidance and local role/state previews matched to the exact code and descriptors. |

Maintain a complete inventory of externally reachable operations with relevant effects on rights, balances, settings or promised service. Map each to a user action, administrative action, system/automation call, or a justified non-applicable interface. Include inherited privileged functions and supporting components. Internal helpers do not each require a button. Review/tests compare declared behavior with actual callable code rather than trusting the descriptor's self-report.

Enforce authority in the relevant contract or service for direct calls as well as host-mediated calls. Hiding a control is not enforcement. At action preparation and execution, account for changed roles, stale values and current revisions where applicable. Explain current value, permitted change, economic effect and acting authority for controlled parameters. Keep a verified history of consequential changes. Account login, gas payer and authenticated module operator are not interchangeable identities.

Bind reads to their actual sources and show absent/stale data as such. Extend module data views and event projections without changing common launch identity. Module-supplied transformations/indexing must be isolated from privileged infrastructure. Backend observation alone does not establish onchain authority. Preserve the distinction between broadcast, confirmation, finalized chain result and external service fulfillment.

Longer workflows declare their step order, approvals, costs, retries and recovery after browser reload, wallet/network change or an uncertain transaction outcome. Do not resubmit blindly and create duplicate jobs. Reconcile the relevant receipt, operation ID and current state before resuming. The host derives the actual transaction/authorization from the admitted action; custom UI cannot silently substitute targets, recipients, scopes or amounts.

Resolve required versus optional host capabilities before availability. A missing capability produces a specific integration requirement in the contributor preview. The author may supply a reviewed renderer, adapter or service implementation through the same package workflow. Capability registration does not by itself grant privileged authority or create a financial obligation for the platform. Existing UI widgets are reusable starting points, not a permanent limit on possible module interfaces.

The local preview must render the package's real configuration, data and action model with controlled fixtures for each meaningful role/state, including pending, failed, stale and unavailable conditions. Require relevant mobile and keyboard coverage. Product controls use understandable effects and labels; implementation details need not leak into the user's normal flow.

Documentation is a required part of the same reviewed package: setup, operation, roles, financial effects, mutability, external requirements, failure recovery and maintenance of existing instances. Record code, schema, action/data and presentation revisions. Presentation-only fixes can preserve the established action contract; changes to targets, rights or economic semantics need their own review. A mutable UI URL cannot redefine a launch's operation. Keep older active instances resolvable and preserve essential management/claim fallback when a version is closed to new launches.

## Composition review and financial claims

The resolver evaluates the whole graph, complete configuration and aggregate resources. Pairwise compatibility is necessary in some models but insufficient as a general proof. Review must include interactions and economic scenarios: zero subsequent volume, fragmented orders, repeated/multiple-wallet actors, different routes, stale data, empty budgets and hostile ordering. A module reading the actual actor does not prove that different wallets represent different people.

Randomness-dependent modules require a provider-appropriate commitment/request/result model, closed outcome-affecting inputs, replay/order protection and funded obligations. Chainlink documents these issues in its [VRF security guidance](https://docs.chain.link/vrf/v2-5/security); that reference does not establish Robinhood service availability. Technical review, economic assumptions and jurisdiction-specific eligibility are separate assertions. An actual Ponzi remains deceptive investment activity regardless of contract correctness; the platform must not turn a technical review label into a promise of economic safety. [Investor.gov](https://www.investor.gov/protect-your-investments/fraud/types-fraud/ponzi-scheme)

Author rewards require an admitted canonical compensation family, deduplicated across versions, repeated instances and transitive helpers. Multiple genuine modules by the same author still receive multiple shares. A new address/salt/codehash is insufficient evidence of a distinct contribution. Define the treatment of wrappers, copies and deliberately inactive configurations without assuming a temporarily zero effect makes a valid module worthless. Preserve licensing and attribution evidence. Show the exact paid families before the launch is signed.

## Contribution and catalogue scale

Source-first packages must validate before a chain deployment exists. Keep contributions in author repositories and accept small versioned descriptors through GitHub/API into the same durable submission record. Pin repository/revision/build/dependencies and make retries idempotent. Structural checks, isolated builds/tests, substantive review, exact-version admission and chain activation have distinct statuses.

Prefetch exact dependencies into a bounded cache before offline untrusted builds. Builds receive no production secrets, signing credentials, OIDC or publishing authority. Contributors cannot alter the trusted review harness via their intake descriptor. Provide status and actionable machine-readable errors. Apply proportionate spam/rate/resource controls without assuming a platform-token purchase requirement.

The initial operating assumption is several contributions and a manageable review queue, not millions of submissions. Start with one durable intake, clear feedback, isolated checks and explicit review ownership. Keep searchable metadata and exact-revision retrieval extensible; add workers or infrastructure only when measured demand warrants them. Reuse review evidence only for matching code and admitted configuration/composition bounds. Novel protected rights and interactions still need substantive review.

An admitted version remains directly configurable and launchable inside its reviewed parameter/composition envelope. Each new permitted recipient or percentage must not require a fresh manual per-coin approval. The execution path still checks that envelope; a new right or unreviewed interaction does not inherit approval merely because the code version is unchanged.

The starter must let an independent developer create, locally simulate, check and submit a contribution. Measure first simulation, successful submission, review effort and central product changes required per admitted module. AI assistance uses the same interfaces and validation; it is optional.

## Acceptance additions

1. Use one template with two distinct configurations, nested recipient rows and an authenticated role. Share/import it as a different launch wallet and on an eligible alternate quote without retaining unintended bound addresses.
2. Demonstrate a new contributor input shape and post-launch action using the generic host/API without adding a privileged custom frontend path.
3. Prove aggregate budget rejection for three pairwise-admissible allocations, correct measured fee basis, no duplicated claims/fees, and separation of old claims, CTO personal payouts and committed module funding.
4. Demonstrate canonical graph commitments for shared versus separate dependency instances and unchanged old recipes after catalogue/template updates.
5. Exercise delayed/reordered/failed external completion and terminal recovery without forfeiting existing claims or creating unfunded liabilities.
6. Submit a source package with no deployment, reproduce its isolated build, receive usable review status, then separately bind a chain activation. Preserve the open architecture's independent unforeseen-contribution and new-engine acceptance tests.
7. Ship one controllable module's full management description and local website preview: all relevant operations accounted for, legitimate controls usable, direct unauthorized calls rejected, controlled values within launch-bound policy, and required capabilities/data/services actually resolved before availability.
8. Prove that the displayed operation and actual authorization agree, interrupted workflows reconcile without duplicate execution, and an older live instance remains usable after a new package/presentation release. Documentation must describe the same tested roles and behavior.

Passing these concrete demonstrations supports a bounded contributor preview. Production availability additionally requires appropriate independent review and actual deployment, source, lifecycle, indexing and payout evidence.
