# Agent entry and application contract

This reference separates the active **Public GitHub PR Builder Beta** from a later **Connected Submission service**.
Today, builders keep their complete project in an external public GitHub repository and submit a bounded six-file
application record through a draft pull request. The wallet, GitHub App, claim, application-service, status-API, permit,
and website-launch contracts later in this file are future design contracts and are not active beta capabilities.

## Contents

- [Product boundary](#product-boundary)
- [Current Public GitHub PR Beta](#current-public-github-pr-beta)
- [Default entry](#default-entry)
- [First agent behavior](#first-agent-behavior)
- [Knowledge ownership](#knowledge-ownership)
- [Later Connected Submission service](#later-connected-submission-service)
- [Identity model](#identity-model)
- [Builder journey](#builder-journey)
- [Application draft](#application-draft)
- [Human claim and identity](#human-claim-and-identity)
- [Repository policy](#repository-policy)
- [Application status](#application-status)
- [Custom Hook website flow](#custom-hook-website-flow)
- [Launch eligibility](#launch-eligibility)
- [Revision rules](#revision-rules)
- [Review boundary](#review-boundary)
- [Approval and launch binding](#approval-and-launch-binding)
- [Launch details](#launch-details)
- [Promotion to a launch model](#promotion-to-a-launch-model)
- [Minimal website contract](#minimal-website-contract)
- [Agent command contract](#agent-command-contract)
- [Portability](#portability)
- [Required acceptance tests](#required-acceptance-tests)
- [Source-of-truth order](#source-of-truth-order)

## Product boundary

Programmable does not provide a separate chat interface. The builder uses Codex, Claude Code, Hermes, GitHub Copilot,
or another capable coding agent. The Programmable skill supplies the workflow, rules, schemas, validators, and current
platform context that the agent needs.

The skill is the technical engine. In the current beta, the website may provide discovery and installation entry
points, while GitHub hosts the public source and application review thread. A later Connected Submission service may
add human identity binding, service-backed application status, review results, and an approved launch handoff.

The skill must make the declared project reviewable, whether it uses a custom hook, the ordinary no-hook launch path,
or additional app, game, service, keeper, or indexer surfaces. It must never promise that generated code is perfect,
safe, audited, accepted, deployed, or available.

## Current Public GitHub PR Beta

The current application boundary is deliberately small:

```text
idea or existing project
  -> Explore and design card
  -> deterministic and semantic preflight
  -> proposal or capability-driven prototype in the builder repository
  -> local package gate
  -> clean, pushed, anonymously reachable public GitHub revision
  -> deterministic six-file central application package
  -> draft pull request to 0xprogrammable/programmable
  -> GitHub-native review
```

The complete source stays in the builder repository. The central pull request contains exactly:

```text
submissions/<application-id>/
├── application.json
├── PROPOSAL.md
├── TEST_PLAN.md
├── THREAT_MODEL.md
├── compatibility-report.json
└── evidence-index.json
```

`applicationId` is the stable lowercase project slug and central directory name. The source identity is the canonical
public GitHub repository URI, numeric repository id, exact commit, root tree, declared paths, and evidence bound inside
`application.json`. The pull-request number identifies the public review thread. Neither identifier is a remote draft,
wallet-owned application, claim secret, approval, or launch authorization.

The public record separately binds the builder. `prepare-pr` resolves the declared GitHub login through the anonymous
public `/users/<login>` endpoint and records the exact decimal GitHub user id. The trusted intake workflow compares that
id and the current display login with the pull-request author event. Preserve the numeric id across revisions while
allowing the login and contact to follow a GitHub rename. This proves the central PR author identity only, not ownership
of the linked source repository.

A project may bind zero to eight additional public companion repositories through canonical manifests committed in the
primary HEAD. Each companion is independently pinned to its numeric repository id, full commit, root tree, and declared
paths. This supports split contract, app, game, service, keeper, oracle, indexer, or other reviewable architectures
without pretending they are one repository.

The implemented beta commands are `doctor`, `scaffold`, `check`, `package`, and `prepare-pr` through
`scripts/cli.mjs`. `prepare-pr` resolves the pushed public revision and prepares the six files plus draft PR metadata. An
explicit `--output-dir` may materialize those six files locally, but the command does not push, open a pull request,
connect an account, sign, deploy, or launch. Opening the draft pull request remains a separate external action requiring
explicit authority.

The output distinguishes the builder `sourceHead` from the exact central pull-request target. A new open application
stays at revision 1; an open update stays at the single prior-main revision plus one. `--replace-existing` creates the
first update draft only from an exact local copy of immutable main. Every later iteration of that same open pull request
uses `--replace-draft`, which preserves the pending revision and lineage. Both modes require an output directory outside
the builder repository and never change GitHub by themselves.

GitHub checks, labels, review comments, and pull-request state are the current workflow projections. They do not become
security, audit, acceptance, deployment, routing, provider, or availability evidence by implication. Do not ask the
builder to connect a wallet, install a GitHub App, claim a draft, query an application-status endpoint, or prepare a
launch permit for this beta.

## Default entry

A copy action and any future `Open in Codex` action use exactly this prompt:

```text
Use the Programmable v4 Builder skill. Learn how Programmable works first, then help me explore an open-ended Uniswap v4 project for the platform.
```

Do not replace it with a prompt that starts implementation immediately. A builder may append an idea in ordinary
language, but the agent still begins in Explore mode.

The entry surface may offer:

1. Install the complete skill package.
2. Copy the default prompt.
3. Open the builder's coding agent with the default prompt when that agent supports a documented deep link.

Never tell a builder to paste only `SKILL.md`. The references, schemas, templates, and deterministic scripts are part of
the skill contract.

## First agent behavior

After invocation, the agent:

1. Reads the complete loaded `SKILL.md`.
2. Resolves the current Programmable platform manifest.
3. States briefly what it can help create and what requires later human review.
4. Asks for the intended project and token behavior in plain language.
5. Brainstorms before implementation when the idea is still open.
6. Asks only the first unresolved question that changes architecture, value flow, custody, authority, failure behavior,
   legal exposure, or trader experience.
7. Shows a short design card before creating the structured submission.
8. Does not write a production implementation until deterministic and semantic preflight permit a prototype.

The builder should not need to understand callback names, permission masks, PoolManager accounting, Foundry, or the
repository structure. Keep those details in generated artifacts unless they change the builder's decision.

## Knowledge ownership

Keep stable and mutable knowledge separate.

### Skill-owned stable knowledge

The installed package owns:

- The idea, preflight, prototype, repair, review, and submission workflow
- Programmable compatibility and security policy
- Uniswap v4 implementation and evidence requirements
- Submission schemas and templates
- Deterministic validators and package hashing
- Required tests, threat model, value-flow, routing, and lifecycle evidence
- Human authorization boundaries
- Application and release-state semantics

### Platform-owned current knowledge

A versioned, machine-readable Programmable manifest owns:

- Canonical website, documentation, GitHub, security contact, and X URLs
- Supported chain ids and official deployment sources
- Current token, factory, launcher, hook, router, and registry addresses
- Current launch models and their availability states
- Current disclosed platform fee policy and immutable application limits
- Current policy version, schema version, minimum supported skill version, and manifest expiry
- Application, claim, status, and launch-handoff endpoint versions after the Connected Submission service is activated

The agent must not rely on an installed snapshot when a current manifest is required. Validate the manifest origin,
schema, version, expiry, and integrity before using mutable facts. If the manifest is missing, expired, unsupported, or
conflicts with chain evidence, stop the affected action and report the exact blocker.

No manifest or skill package contains secrets, private keys, wallet sessions, broad GitHub credentials, unpublished
vulnerability details, or deployment authority.

### Human-readable discovery

`llms.txt` may explain Programmable and link the canonical machine-readable resources. It is navigation, not the source
of truth for addresses, approval, deployment, or availability.

## Later Connected Submission service

The connected-service sections from **Identity model** through **Agent command contract**, plus **Required acceptance
tests** and **Source-of-truth order**, define a later service-backed release. They are retained as a future product and
security contract, not as instructions for the current Public GitHub PR Beta. **Portability** applies to both paths.
Until an implemented, tested, and activated service contract explicitly says otherwise:

- there is no connected-service application id or remote application draft;
- there is no wallet/GitHub identity binding, GitHub App installation, claim URL, or claim code;
- there is no application-service status, approval, launch eligibility response, or one-time permit; and
- the corresponding future command capabilities must not be presented as installed CLI commands.

## Identity model

The connected Ethereum wallet is the primary Programmable profile and transaction identity. Existing Explore, Launch,
Profile, token, and reward flows continue to use that wallet.

GitHub is an additional source and repository connection required only for Custom Hook applications. Connecting GitHub
does not replace the wallet session and does not create launch eligibility by itself. Each wallet is a separate
Programmable profile for the initial release; switching wallets must not silently carry applications to another profile.

Use GitHub App user authorization to identify the GitHub user and the same GitHub App installation to access the selected
repository. Do not use a separate broad OAuth application. Request read-only Contents and Metadata access and let the
builder select only the repository used for the application. Do not request repository write, administration, workflow,
issue, pull-request, organization, email, or all-repository access unless a later feature proves that it needs one of
those permissions.

Server-side, verify that the authorized GitHub user currently has `ADMIN` permission for the selected repository and
that the installation can read it. Installation access alone is not enough to identify the human claimant. Store and
bind the immutable GitHub user id, numeric repository id, installation id, installation account id, and selected
repository owner/name. Use numeric ids as identity and owner/name as display data so a rename does not create a new
identity.

Keep GitHub user and installation tokens short-lived, server-side, encrypted at rest where retained, and out of browser
storage, logs, repositories, agent context, and public status responses. Support several installations by asking the
builder to choose the GitHub account or organization first and then one repository.

The authenticated platform session binds:

- Wallet address and wallet-session nonce
- GitHub user id, App installation, installation account, and selected repository
- Application id and revision
- Exact reviewed commit and review-target hash

The browser must never decide that this binding is eligible. It displays the authenticated application service result.

## Builder journey

The canonical journey is:

```text
idea
  -> brainstorm
  -> design card
  -> deterministic and semantic preflight
  -> isolated prototype
  -> tests and evidence
  -> application draft
  -> human claim
  -> automated review
  -> maintainer review
  -> changes requested or approved
  -> one-time launch handoff
  -> wallet-authorized launch
  -> receipt-backed launched state
```

An agent may stop at any stage and resume from the exact repository commit and application revision. No stage inherits
proof or authority from the previous stage.

The website supports both entry orders:

1. **Agent first:** the agent prepares a draft and returns a claim link. The builder opens it, connects the wallet and
   GitHub repository, then claims the application.
2. **Website first:** the builder opens Custom Hook, connects the wallet and GitHub repository, and the application
   service looks for an unclaimed or already claimed draft for that exact repository. If none exists, the page offers
   the skill installation and default prompt instead of an empty launch form.

Selecting a repository never creates or approves an application. The agent must first create the reviewed package and,
with explicit builder consent, submit the application draft. The human then claims that exact draft and revision.

## Application draft

After the package passes its required local gates, the agent may prepare an application draft. Creating the remote draft
is an external write and requires the builder's explicit approval.

The draft binds:

- Application id and revision
- GitHub numeric repository id, installation account id, repository owner, and repository name
- Exact commit SHA
- Submission content hash
- Review-target hash
- Skill version, policy version, schema version, and platform-manifest digest
- Builder-stated public project metadata
- Requested launch behavior and configuration bounds
- Required review tier and unresolved findings

The draft is initially unclaimed. It grants no approval, fee rights, launch right, deployment authority, endorsement, or
ownership.

The service returns a short-lived, single-use claim URL or claim code. The code is a secret until consumed and must
never be committed to the repository, printed in public logs, or included in an application status file.

Draft creation is idempotent for the same repository id, commit, submission hash, and review-target hash. A retry returns
the same active draft rather than creating several competing applications. Claim, revision, approval, withdrawal,
revocation, and launch transitions use atomic compare-and-swap or equivalent transactional uniqueness.

## Human claim and identity

The agent is never the application owner. A human claims the draft by:

1. Connecting the launch wallet or confirming the already connected wallet.
2. Opening the claim URL or entering Custom Hook from the launch page.
3. Installing or connecting the GitHub App with access limited to the selected repository.
4. Reviewing the repository, commit, public metadata, requested behavior, and disclosed economics.
5. Signing typed data that binds the application and exact revision.

GitHub may require an organization owner to approve an installation request. Keep the application pending and show
`GitHub approval required`; do not treat the request itself as repository access.

Claim secrets use at least 256 bits of cryptographic randomness, are stored only as hashes, expire quickly, are
rate-limited, and are consumed atomically by a POST request. Claim pages use a wallet-bound session, CSRF protection,
`Referrer-Policy: no-referrer`, redacted logs, and no third-party scripts or analytics that could receive the URL.
Possession of an application id or leaked claim URL alone is never ownership.

The typed claim binds at least:

- Application id and revision
- Repository and exact commit SHA
- Submission hash and review-target hash
- GitHub user id and numeric repository id
- Claiming wallet
- Chain id
- Signature action and application-service version
- Nonce
- Expiration

GitHub identifies the selected source repository and account. The wallet identifies launch and reward authority. Do not
collapse these identities or infer one from the other.

Use separate EIP-712 action types for application claim, revision confirmation, ownership rebind, and launch
configuration. Bind the environment, service version, chain id, verifying contract, application, revision, GitHub user
and repository ids, wallet or executor, content or configuration hash, nonce, and expiry. Support EOAs and EIP-1271
contract wallets.

Reconnecting the same GitHub installation does not require a new application. Changing the bound wallet requires current
GitHub-admin proof, a fresh wallet signature, a cooldown or maintainer-controlled recovery decision, reapproval, and
invalidation of every outstanding approval and launch permit. A wallet address typed into a form is not sufficient.

## Repository policy

The initial Custom Hook release accepts public GitHub repositories only. The exact reviewed source and evidence must
remain publicly inspectable through launch. Private repositories can be designed later with a separate disclosure,
retention, and reviewer-access policy.

One numeric GitHub repository has one Custom Hook application lineage. The builder may submit any number of reviewed
revisions inside that lineage before launch. The repository may produce exactly one successful token launch on Ethereum
Mainnet through Programmable. After that launch, its repository key is permanently consumed across every Programmable
factory version.

A copied or forked repository has a different numeric id and therefore requires a completely new application and review.
This rule prevents accidental or replayed reuse; it is not a claim that copying code is impossible.

Derive the onchain repository key exactly as:

```text
keccak256(abi.encode("programmable.github.repository.v1", uint256(githubRepositoryId)))
```

Do not derive it from owner, repository name, URL, branch, installation, wallet, or application id.

Repository access rules:

- A rename keeps the same repository identity because the numeric id is unchanged.
- A transfer to another account pauses launch preparation until ownership and installation access are rechecked.
- Making the repository private, deleting it, removing the GitHub App, or removing the selected repository from the
  installation blocks new launch preparation until access and public provenance are restored.
- Loss of the connected GitHub user's `ADMIN` permission blocks claims, revisions, approval, and permit issuance.
- Historical application and review records remain immutable after access is revoked.
- The approved commit may differ from the current default-branch head. Launch always uses the approved commit. A newer
  commit requires a new revision; it does not silently invalidate or replace the approved one.

At submission, prove that the full commit SHA is reachable from a declared ref in the selected repository. Fetch the
source bundle server-side through the installation and retain a content-addressed digest. Bind the exact Git tree,
submodule commits, Git LFS objects, compiler inputs, dependency closure, and review target. Moving branch or tag names
never enter review or launch evidence.

Process verified GitHub App webhooks for installation suspension or deletion, repository removal, transfer, visibility,
and permission changes. Recheck GitHub identity, effective `ADMIN` permission, repository visibility, installation
access, and source bundle immediately before approval and immediately before permit issuance; webhooks alone are not
the source of truth.

## Application status

Expose these builder-facing states:

- `draft-unclaimed`
- `submitted`
- `in-review`
- `changes-requested`
- `approved`
- `launched`
- `not-supported`
- `withdrawn`

Internal processing may use more detailed states, but the website and agent must map them consistently to this list.
The compact label `Pending` may cover `submitted` and `in-review`, but the detailed view must show the exact state.

Keep independent state axes instead of forcing every event into the application status:

- Claim: `unclaimed`, `claimed`, `expired`, or `consumed`
- GitHub access: `connected`, `approval-required`, `revoked`, or `suspended`
- Review: the builder-facing application states above
- Permit: `not-issued`, `pending`, `ready`, `expired`, `consumed`, or `invalidated`
- Transaction: `not-started`, `awaiting-signature`, `submitted`, `confirmed`, `failed`, `replaced`, or `dropped`

`submitted` means the claimed revision is queued and no reviewer is actively processing it. `in-review` means automated
or maintainer review is active. `not-supported` is terminal for the reviewed revision; maintainers may allow a materially
redesigned revision in the same pre-launch lineage. `withdrawn` closes the lineage unless its owner explicitly reopens
it before launch. A consumed repository key can never reopen.

A public status response may include:

- Application id
- Revision
- Public state
- Public repository and exact commit
- Review-target hash
- Last update time
- Sanitized findings
- Required next action

Do not expose private repository data, claim codes, credentials, internal reviewer notes, personal information, or
unpatched exploit details through the public status endpoint.

An authenticated owner response may add complete requested changes and claim or revision controls. It still must not
expose platform secrets or another applicant's private information.

## Custom Hook website flow

When the builder selects `Custom Hook`:

1. If no wallet is connected, show `Connect wallet`.
2. After the wallet session is valid, show `Connect GitHub`.
3. Send the builder through the GitHub App installation flow with `Only select repositories`.
4. If several installation accounts exist, let the builder select one.
5. List only public repositories available to the selected installation.
6. Let the builder choose one repository.
7. Resolve the application and launch-eligibility state on the server.
8. Render exactly one state:
   - No application: install the skill, copy the default prompt, or open the supported agent.
   - Draft unclaimed: claim the application with a wallet signature.
   - Submitted or in review: show the exact commit and pending status.
   - Changes requested: show actionable findings and a copyable agent-resume instruction.
   - Approved: show the launch-details form.
   - Launched: show the token and transaction.
   - Not supported or withdrawn: show the decision and permitted next action.

Do not show token metadata before the application is approved. An approved application with
`LAUNCH_DETAILS_REQUIRED` may open the metadata form while `eligible` remains false. Show the launch button only after
the completed details are bound to a valid permit and the service returns `PERMIT_READY` with `eligible: true`. Do not
require GitHub for Classic or other curated launch models.

If several GitHub accounts or installations are available, select the account first. If no repository is available,
show that the App needs access to one public repository. If the repository belongs to another wallet profile, return a
generic conflict and an ownership-recovery path without revealing that profile.

## Launch eligibility

Application status and launch eligibility are separate. An application can be approved while launch is temporarily
blocked by a revoked GitHub installation, expired permit, unsupported chain, wrong wallet, stale platform manifest, or
failed runtime recheck.

The authenticated eligibility response contains:

- Wallet address
- GitHub numeric repository id and display name
- Application id and approved revision
- Approved commit, submission hash, and review-target hash
- Application status
- `eligible` boolean
- Stable reason code
- Permit state
- Repository-key consumption state from the shared registry
- Launch-details draft and validation state when approved
- Final token, transaction, receipt, and runtime record when launched
- Required next action

The exact portable response contract is
[application-api.schema.json](application-api.schema.json). UI mocks, agent clients, and the future application service
must use the same schema version rather than maintaining separate status enums.

Use stable reason codes:

- `WALLET_REQUIRED`
- `WRONG_WALLET`
- `GITHUB_REQUIRED`
- `GITHUB_APPROVAL_REQUIRED`
- `REPOSITORY_REQUIRED`
- `NO_REPOSITORIES_AVAILABLE`
- `REPOSITORY_CLAIMED`
- `REPOSITORY_ACCESS_REVOKED`
- `REPOSITORY_NOT_PUBLIC`
- `APPLICATION_NOT_FOUND`
- `APPLICATION_UNCLAIMED`
- `CLAIM_EXPIRED`
- `CLAIM_CONSUMED`
- `APPLICATION_PENDING`
- `CHANGES_REQUESTED`
- `REVISION_MISMATCH`
- `NOT_SUPPORTED`
- `APPROVAL_EXPIRED`
- `MANIFEST_STALE`
- `NETWORK_UNSUPPORTED`
- `REVIEW_TARGET_MISMATCH`
- `LAUNCH_DETAILS_REQUIRED`
- `PERMIT_READY`
- `PERMIT_CONSUMED`
- `TRANSACTION_PENDING`
- `TRANSACTION_FAILED`
- `LAUNCHED`

Only `PERMIT_READY` may return `eligible: true`. A reason code is not a substitute for the signed launch permit.

The approved path is:

```text
approved
  -> LAUNCH_DETAILS_REQUIRED and eligible=false
  -> builder enters token and project data
  -> server validates and binds the exact launch configuration
  -> PERMIT_READY and eligible=true
  -> wallet signature or transaction
  -> TRANSACTION_PENDING and eligible=false
  -> receipt and runtime checks
  -> LAUNCHED with the final launch record
```

The API exposes GitHub authorization, installation choices, repository choices, selected repository, application,
eligibility, launch draft, transaction, and repository-registry state separately. This lets the UI represent a connected
GitHub user before an installation or repository has been selected.

## Revision rules

Every source change creates a new application revision with a new commit, submission hash, and review-target hash.
Earlier review evidence remains attached to the earlier revision. Approval never transfers automatically to changed
code.

The agent may prepare a revision only after showing the builder what changed and rerunning every invalidated gate. A
revision submission is an external write and requires explicit approval.

The exact transition is:

```text
changes-requested
  -> agent prepares a new commit and review target
  -> builder confirms the new revision with GitHub access and an EIP-712 wallet signature
  -> submitted
  -> in-review
  -> changes-requested or approved
```

The builder may ask the agent for status when either the repository contains the public application record or the
builder supplies the application id. A new agent session must not pretend to remember an application that it cannot
resolve.

A repository may store `.programmable/application.json` containing only:

```json
{
  "applicationId": "public-id",
  "repository": "owner/repository",
  "commit": "full-commit-sha",
  "statusUrl": "https://programmable.family/applications/public-id"
}
```

Do not store authentication tokens, claim codes, signatures, wallet secrets, or private findings in this file.

## Review boundary

Automated review combines deterministic package validation, isolated compilation and tests, static analysis, dependency
and source closure, permission checks, and semantic review. Untrusted code runs without credentials, wallet access,
signing material, production network write access, or repository write permission.

Automated review may produce findings and a recommendation. It cannot approve arbitrary custom hooks by itself.
Programmable maintainers approve or reject the exact bound revision. High-risk capabilities may require an additional
review owner or remain unsupported.

Changes requested must cite the affected revision and identify actionable findings without publishing an exploitable
vulnerability before it is fixed.

## Approval and launch binding

Approval initially authorizes one custom token launch by the bound wallet. It does not create a reusable public launch
model.

The approval record binds:

- Application id and approved revision
- Repository commit, submission hash, and review-target hash
- Chain id and deployer wallet
- Compiler and dependency closure
- Expected runtime or build hash
- Hook permission mask and expected CREATE2 address
- Constructor arguments and permitted launch configuration
- Token, pool, liquidity, fee, and recipient rules
- Nonce and deadline

The launcher or factory must verify a one-time signed permit derived from this record and mark it consumed. The website
must not be the only enforcement layer. This prevents reviewed code from being replaced before launch.

Use a registry shared by every supported factory version. Atomically check and consume both the permit digest and the
numeric repository key before external launch calls, without `tx.origin`, and reject reentrancy. Enforce one successful
launch for the repository lineage in the application service as a second, non-authoritative guard. Concurrent
preparation requests must resolve to one active permit, and a reverted transaction must not be recorded as launched.

Permits have short deadlines and bind the current approval epoch. Repository, GitHub, wallet, approval, or security
revocation increments or cancels that epoch in the onchain registry before another launch may proceed.

The launch requires an explicit wallet transaction. The skill, agent, application service, and review worker never sign
or broadcast it for the builder.

Only a receipt-backed transaction and runtime checks can set `launched`. Approval, simulation, a prepared transaction,
or a wallet prompt cannot.

Track replacement transactions by wallet nonce and final hash. A failed, dropped, or reverted transaction does not
consume the repository key when the onchain state transition reverted; it may be retried only while the same exact
permit remains valid.

## Launch details

After eligibility, the builder supplies only token and project metadata plus parameters that the approved launch schema
explicitly leaves configurable:

- Token name
- Ticker
- Square token image
- Short description
- Website, X, and Telegram links when used
- Any initial buy supported by the approved model
- Any model-specific value already constrained by the approved configuration bounds

The builder does not upload different hook code or change unapproved permissions, fee bounds, recipients, pool rules,
dependencies, or constructor behavior at this stage.

Before producing the permit, validate and bind the exact token metadata, metadata content hash or URI, launch wallet,
chain, approved repository and revision, hook build, constructor arguments, pool configuration, fee disclosure,
recipient configuration, initial buy, nonce, and deadline.

Show a short review with the token details, exact source commit, behavior summary, disclosed fees, pool pair, initial
buy, estimated network cost, and one-time-launch notice. The builder then signs the single wallet transaction required
by the approved launch path.

The initial release has no scheduled launch date. Launch happens when the bound wallet submits and the Mainnet
transaction confirms.

## Promotion to a launch model

A successful custom token may later become a reusable Programmable launch model through a separate maintainer decision.
Promotion binds one exact implementation and version, assigns any model-builder economics explicitly, completes the
full platform integration and release gates, and never follows automatically from popularity or one successful launch.

## Minimal website contract

The first website implementation needs only:

- A `Custom Hook` launch card
- Install skill
- Copy the default prompt
- Optional `Open in Codex` when a stable, documented deep link exists
- Wallet-first session
- GitHub App connection with selected-repository access
- Repository selector
- Claim application
- Profile `Applications` list
- Application status and sanitized review findings
- Revision confirmation
- Server-backed eligibility state
- Approved token-details form
- `Launch` after approval

It does not need a Programmable chat interface, browser IDE, contract editor, or website-based agent. Until the backend
contract is implemented, the design work may use mock data but must not invent new states, authorization, or approval
semantics.

## Agent command contract

For the current beta, use only the implemented `doctor`, `scaffold`, `check`, `package`, and `prepare-pr` commands in
`scripts/cli.mjs`. Their released `--help` output is authoritative for flags.

The following names describe later Connected Submission service capabilities. They are not active beta commands:

- `prepare`: create or update a structured local application package
- `validate`: run preflight and all locally available required gates
- `submit-draft`: create an unclaimed remote draft after explicit approval
- `claim-status`: show the claim URL state without revealing the claim secret
- `status`: retrieve public or authenticated application status
- `update`: submit a new exact revision after explicit approval
- `withdraw`: withdraw the application after explicit approval
- `prepare-launch`: verify an approval and prepare the bound launch handoff without signing

Do not claim that a command exists until its implementation and tests are present in the installed package. Host
adapters may wrap these capabilities but may not weaken their authorization or evidence requirements.

## Portability

Distribute one canonical skill package. Agent Skills-compatible hosts install the complete folder. Other coding agents
may use an adapter or the same portable CLI and machine-readable contract. Do not maintain weaker policy copies for
individual agents.

Each host may differ in shell, sandbox, network, context, and wallet support. Full prototype work requires a capable
coding environment. Brainstorming and preflight remain useful in restricted agents, but the agent must report missing
tool evidence rather than fabricate it.

## Required acceptance tests

Before the later Connected Submission flow is available, prove at least:

- A disconnected visitor cannot read private application details or prepare a launch.
- GitHub connection does not disturb the existing wallet session.
- A GitHub installation limited to repository A cannot select repository B.
- The authorized GitHub user must retain `ADMIN` permission for the selected repository.
- An organization installation awaiting owner approval remains blocked.
- No available repositories and a repository bound to another wallet return non-leaking blocked states.
- The wrong wallet cannot claim, revise, prepare, or launch another wallet's application.
- The same draft submission is idempotent.
- A repository rename preserves identity; transfer, deletion, private visibility, or revoked access blocks preparation.
- A changed commit cannot inherit an earlier approval.
- `changes-requested` cannot reach the launch form.
- The approved commit remains explicit when the default branch advances.
- Two concurrent prepare requests cannot create two valid active permits.
- A permit cannot be replayed, used by another wallet, used on another chain, or used with changed metadata or
  constructor arguments.
- The shared onchain registry prevents one numeric repository from creating a second token through any factory version.
- A reverted transaction remains retryable under the permit's exact onchain semantics and is not marked launched.
- Replaced, dropped, failed, and delayed transactions reconcile to one final transaction state.
- Only a final receipt plus runtime checks changes the state to `launched`.
- Public status never exposes claim secrets, installation tokens, private findings, or credentials.

## Source-of-truth order

This order applies to the later Connected Submission service. For the current beta, resolve application workflow from
the central GitHub pull request and its trusted checks, and resolve project source from the exact public GitHub identity
inside the six-file application record. Neither source can create an approval or launch fact.

For the later service, resolve facts in this order:

1. Ethereum receipts, runtime code, and contract state for onchain facts
2. Maintainer-owned signed records for review and approval
3. Programmable application service for workflow status
4. Exact Git commits and package hashes for source
5. Versioned Programmable platform manifest for current public configuration
6. Installed skill policy and schemas for the build process
7. Human-readable docs and `llms.txt` for navigation
8. Third-party indexers for discovery only

If two sources conflict, do not silently pick the more convenient one. Stop the affected action, report the conflict,
and identify the owner who can resolve it.
