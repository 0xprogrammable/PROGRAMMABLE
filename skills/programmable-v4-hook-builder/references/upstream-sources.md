# Upstream source policy

Source snapshot observed on 2026-08-01.

Official code is a source, not an automatic compatibility guarantee. Use exact revisions and test the complete version
set together.

The machine-readable snapshot is [upstream-sources.json](upstream-sources.json). Use
[routing-and-discovery.md](routing-and-discovery.md) before making listing, indexing, quote, routing, interface, or
provider-approval claims.

## Two distinct baselines

### Programmable-tested baseline

This is the dependency set currently pinned by the canonical Programmable repository. Existing releases and their source
evidence depend on these exact revisions. Do not update them as a side effect of a new model.

### Observed upstream baseline

This records newer official revisions and resources observed during skill research. It is input to a deliberate upgrade
or model-specific dependency decision, not permission to mix versions.

For a new model, choose one coherent baseline and record it in `compatibility.lock.json`. If a newer component is needed,
test its complete compatible core, periphery, hooks, SDK, router, deployment, and compiler set in isolation. Never float
core and periphery independently.

Every machine-readable observed-source record deliberately has `compatibilitySet: null` and
`notAResolvedBaseline: true`. `dependencyEdges` records exact locks observed inside that repository; it does not turn
separate repository heads into a compatible profile.

## Official launchpad deployment gate

The committed [official launchpad deployment reference](official-launchpad-deployments.json) is the only bundled address
input for the CCA-to-LBP profiles. It separates official deployment-feed fields, repository release commits,
documentation observations, chain IDs, addresses, feed status, source-resolution status, and runtime-verification status.
It currently models complete reference profiles for Ethereum, Base, Unichain, and Sepolia:

| Component | Accepted reference version | Source status |
| --- | --- | --- |
| `ContinuousClearingAuctionFactory` | `v2.1.0` | Deployment commit pinned; v1.1 is an explicit rejected default |
| `LiquidityLauncher` | `v3.0.0` | Deployment commit pinned |
| `LBPStrategy` | `v3.1.0` | Deployment commit pinned per chain |
| `UERC20Factory` / `USUPERC20Factory` | `v2.0.0` | Deployment commit pinned per supported profile |
| `PoolManager`, `PositionManager`, `UniversalRouter`, `Permit2` | Exact official feed record per chain | Feed reference retained, but unresolved to a full deployment commit and runtime-unverified |

Never accept an address copied from a prompt, issue, environment variable, or floating web page. Select a committed
profile ID; then separately verify chain ID, runtime bytecode, implementation or immutable configuration, interface
compatibility, and explorer source before execution. Unknown records, mismatched fields, changed hashes, and missing live
evidence block the gate.

Official sources do conflict. The pinned Launchpad deployment docs lag the deployment feed and repository READMEs for
CCA, LBPStrategy, and both token factories. The generic UniversalRouter feed record also differs from the pinned v4 docs
and Universal Router repository on Ethereum, Unichain, and Sepolia; Base is the same address case-insensitively. These
conflicts are recorded rather than silently normalized. The feed addresses remain reference data only and every profile
remains execution-blocked: Ethereum, Unichain, and Sepolia return `blocked-official-source-conflict`; Base separately
returns `blocked-pending-runtime-and-interface-verification` because its router address agrees but runtime evidence is
still absent.

## Ethereum standards and execution semantics

These pins are normative or executable references, not Solidity dependency locks:

| Source | Exact revision | Classification | Use |
| --- | --- | --- | --- |
| `ethereum/EIPs` | `05469aa96bf65b532b6239d37c1a5d8b2eca15e6` | Normative Core and Interface standards, CC0-1.0 | EIP-1014 CREATE2, EIP-1153 transient storage, EIP-712 typed data, and EIP-7702 set-code accounts |
| `ethereum/ERCs` | `2bc5bccf25aa06f98644c35fc92e6bf82947cfe2` | Normative ERC standards, CC0-1.0 | ERC-20, 191, 777, 1167, 1271, 1363, 2612, 2771, 4626, 6909, and 1967 |
| `ethereum/execution-specs` | `2384e39d17a226106a88f6ab34aad4461550ea63` | Executable EVM semantics, CC0-1.0 | The pinned `src/ethereum/forks/cancun` implementation for Cancun behavior, including transient storage |
| `argotorg/solidity` | `8a97fa7a1db1ec509221ead6fea6802c684ee887` | Solidity 0.8.26 compiler source, GPL-3.0 | Compiler release identity; the historical `ethereum/solidity` URL redirects here |

Moved ERC documents in `ethereum/EIPs` are not the canonical ERC text; use the pinned `ethereum/ERCs` repository.
ERC-1822 is `Stagnant`, so a UUPS model must identify and justify that dependency explicitly. An execution-spec revision
does not prove that a target chain supports a fork; retain independent chain and runtime evidence.
The compiler source commit does not identify the executable used for a build. Preserve the resolved compiler binary,
its hash, complete standard JSON input and output, and build-info separately.

## Official components to reuse

### v4 core

Use PoolManager, interfaces, types, PoolKey, PoolId, Hooks permission logic, delta types, and fee libraries from the exact
pinned package. Do not copy PoolManager implementation into a submission.

### v4 periphery and v4 hooks public

Use immutable PoolManager state, safe callbacks, delta resolution, action routing, PositionManager integration, BaseHook,
and HookMiner from the locations appropriate to the selected revision.

Important drift: current v4-periphery no longer contains BaseHook and HookMiner. Their current official home is
`Uniswap/v4-hooks-public`. Reject stale imports instead of silently substituting a different file.

The observed heads are not one compatibility set:

- `v4-periphery@3245c3cb99c48fa1dc2459c3b60abc37d4294aba` locks
  `v4-core@59d3ecf53afa9264a16bba0e38f4c5d2231f80bc`.
- `v4-hooks-public@7da5210f2c81a700820a6b4f585264233d91f349` has repository gitlinks to
  `v4-core@d153b048868a60c2403a3ef5b2301bb247884d46` and
  `v4-periphery@76c1891c481cebb4ff58f262473303f01a2d7393`. Its `foundry.lock` instead records
  `v4-periphery@3779387e5d296f39df543d23524b050f89a62917`.

Preserve both forms of evidence. The hooks-public mismatch is upstream drift, not a resolved dependency profile. Do not
combine either observed set with the independently observed v4-core head or generate from it without selecting and
testing one coherent checkout explicitly.

### OpenZeppelin Uniswap hooks

Prefer its installed base implementations and utilities where their semantics match:

- BaseHook
- custom accounting, async swap, custom curve, and fee bases
- CurrencySettler
- SafeCast and transient utilities
- specialized hooks only after reviewing their exact limitations

The library is experimental and supplied without security or backward-compatibility guarantees. Generated code still
needs compilation, tests, static analysis, fork evidence, and model-specific review.

#### Exact package profiles

Keep these profiles separate from the Programmable-tested baseline above. They are reproducible candidates for a new
model or an isolated dependency upgrade; they do not rewrite the provenance of an existing release.

| Profile | Exact package | npm integrity | Source commit matching package contents | `src` tree | Status |
| --- | --- | --- | --- | --- | --- |
| Stable | `@openzeppelin/uniswap-hooks@1.1.1` | `sha512-DI5lNlNsWCcSbEGdc2SCmxpkAAjlnwf4a1MQcpPEO6kRi1OQUZwYwGG/n379wJdrcj5n0/z7uhZ/wWetG92lrQ==` | `a5f831963087d44a857ec41ddff4da01949f38ff` | `cc1f2d1788c1baf1521f3876521c33af28a86eb7` | npm `latest`; GitHub latest release |
| Preview | `@openzeppelin/uniswap-hooks@1.2.1` | `sha512-x8mOuXtiHX3uOutu+v3VFYVyaC/R2nQ9EJNoV21+c1YsJMx0LNdyIbKb5Xm3hDfWrAeRKwqA9eMff7S+ZvPMDg==` | `12048bb17b93ad9ed683aff9c34b89596280c77d` | `14e4e6843b27d5b914341938d71406636a4a8bd8` | npm `dev`; GitHub pre-release |

The moving `latest`, `dev`, latest-release and pre-release labels were observed on 2026-07-31 and can change.

Pin by exact npm version, registry integrity, lockfile, and the source commit matching the package contents. Do not pin the similarly named Git
tags. The official `v1.1.1` tag points to `bd5287c4a9f5c22c2393f7587a9b357662916115`, whose package metadata says
`1.2.1`. The official `v1.2.1` tag points to `acbd604c409a827f7f98c9517236da860c4fca1a`, whose package metadata says
`1.2.0`. Both tags have the preview `src` tree. The npm artifacts instead match the source commits in the table.

For the stable profile, preserve exact resolutions `@openzeppelin/contracts@5.5.0`, `@uniswap/v4-core@1.0.2`, and
`@uniswap/v4-periphery@1.0.3`. The preview library declares the same compatible dependency family. OpenZeppelin's
current Wizard emits against Uniswap Hooks `1.2.1` and OpenZeppelin Contracts `^5.6.0`; when the Wizard is used, resolve
that to exact `@openzeppelin/contracts@5.6.0` and test it as its own coherent profile. Never float or combine these sets.

#### Fee-base selection

Do not equate every fee base with creator revenue:

- `BaseDynamicFee` and `BaseOverrideFee` modify LP fees.
- `BaseDynamicAfterFee` takes a favorable result difference in the swap's unspecified currency.
- Preview-only `BaseHookFee` takes a percentage of the unspecified currency as ERC-6909 claims owned by the hook.

`BaseHookFee` does not promise ETH-denominated revenue. The fee currency depends on swap direction and on whether the
swap is exact-input or exact-output. Require tests for all four quadrants and disclose the resulting asset. Enforce an
application maximum below the base's 100% ceiling. Define `handleHookFees` deliberately: the base supplies no recipient
split, beneficiary authorization, or payout policy.

The mandatory Programmable policy is stricter and must not be inferred from `BaseHookFee`: it charges executed gross
quote-side volume through quadrant-dependent before/after return deltas, allocates an inclusive fixed 10 bps to the
immutable platform owner, and requires owner-only claims, pool-scoped liabilities, and an explicit self-call policy.

ERC-6909 claims are aggregated by currency at the hook address. Prefer one hook instance per pool. A shared hook must
maintain PoolId-scoped liabilities and prove that the sum of every pool and beneficiary liability never exceeds the
corresponding claim balance or redeemable underlying balance.

#### Generator boundary

The current official generator tool is `uniswap-hooks` in `@openzeppelin/contracts-cli@0.1.3` and
`@openzeppelin/contracts-mcp@0.5.10`, backed by `@openzeppelin/wizard-uniswap-hooks@0.1.1`. Treat its output as a
scaffold. Required application functions can remain TODOs, `BaseHookFee.handleHookFees` receives no automatic access
policy, and pausable output can block liquidity removal or delegate to an unimplemented base callback. Compile and
inspect the exact installed artifact instead of trusting website documentation, which currently describes the stable
API while the Wizard pins the preview API.

These generator packages are AGPL-3.0-only. Invoke the exact pinned tool if useful; do not copy or modify its
implementation in this skill. Generated Solidity must still pass the complete model review.

#### Audit wording

OpenZeppelin's reports cover named historical commits and files, not a later package, derived hook, deployment, or
configuration. In particular, the v1.1 RC2 scope does not cover `BaseHookFee`, `ReHypothecationHook`,
`BaseOracleHook`, or `OracleHookWithV3Adapters`.

Allowed factual wording:

> Uses OpenZeppelin Uniswap Hooks primitives from the pinned release.

Do not say `Audited by OpenZeppelin` unless an independent evidence record proves that OpenZeppelin reviewed the exact
derived source commit and configuration being described.

### Liquidity Launcher and UERC20

Reuse the official token factory, launcher-compatible initializer patterns, position custody components, and lifecycle
interfaces when they match the model. Do not assume every launch model is an auction or that a hooklisted component is
appropriate for Programmable.

The Liquidity Launcher's initializer compatibility check is a useful precedent for a future explicit
`IProgrammableLaunchModel` interface. Interface support does not replace behavioral review.

The current UERC20 Factory head is `a747318fcce114f56a3a21b8bcec83663a61208b`. It is observed drift only; the
Programmable-tested baseline remains `6f18f1cdf80dc173d33d3cd6bbe91ee52c314f68`.

### Scaffolds and historical Foundation references

| Source | Exact revision | Classification |
| --- | --- | --- |
| `Uniswap/v4-template` | `1fbf95547791f0821a170b88c750cb2e04e6818b` | Mechanical Foundry scaffold only; examples and dependency locks are not a Programmable compatibility profile |
| `UniswapFoundation/foundational-hooks` | `0c62b3fb35aaaa91296df78026f221b7ffc644de` | Experimental and explicitly under construction |
| `UniswapFoundation/scaffold-hook` | `66dddea1d5b1f099105ccbef3cbd5d8dac0322e8` | Obsolete historical scaffold with stale assumptions |
| `UniswapFoundation/v4-by-example` | `d73984aeff43462d61c29a009e34d842bdc1bec6` | Educational, concept-only, and based on pre-final dependencies |
| `UniswapFoundation/HookRegistry` | `ac06ed968326d1187ed071688811658c57058722` | Inert legacy registry, superseded for current intake work by `Uniswap/hooklist` |
| `UniswapFoundation/router-rebates` | `5e656dc19102486a1a7e7a4d36d34048e7118b9e` | GPL-3.0, under construction, research only |

The v4 template currently locks OpenZeppelin Uniswap Hooks, Forge Standard Library, and a third-party Hookmate revision.
That mixed scaffold dependency set is why template use must stop at mechanical setup. Do not copy the unlicensed
HookRegistry schema or prose.

### SDKs and routers

Use the current `Uniswap/sdks` sources rather than archived standalone repositories. The observed package snapshot is:

| Package | Exact version | Registry integrity | Git head |
| --- | --- | --- | --- |
| `@uniswap/v4-sdk` | `2.3.1` | `sha512-RByok7qIy7B4A3z2lIru5gTxQVZcmP2wqOsmbV+bTrUkFr8ABjzan0DD/pW64x3akiUe4WnxeX/yMvnq04uBJA==` | `57f126ee4ae5d435938569ad22c489e4a0262ca2` |
| `@uniswap/sdk-core` | `7.19.0` | `sha512-h+WsmaPYyoi7S4Q/SzqdG1tEnVx79KhgXXN3d51SUyvTS03CSHPj9+yymlgrx2hrUQvue9S4lW752w1fzXPn3w==` | `57f126ee4ae5d435938569ad22c489e4a0262ca2` |
| `@uniswap/universal-router-sdk` | `5.11.2` | `sha512-MeBjI8SBWj7fJLHpOl/cU2n2cGJEZW56u2/Vzc59Mzik1LHw4Nq5BHJ7989DEDreEgLlGToIoXKCXzts9fXmBg==` | `fcfaace6e56b2339c61bb080d73b7308d5329a94` |
| `@uniswap/permit2-sdk` | `1.4.0` | `sha512-l/aGhfhB93M76vXs4eB8QNwhELE6bs66kh7F1cyobaPtINaVpMmlJv+j3KmHeHwAZIsh7QXyYzhDxs07u0Pe4Q==` | `8c4c91de04e36658f1be6a4918ba30e80c808ea2` |
| `@uniswap/router-sdk` | `2.11.1` | `sha512-hzBPnrrD08D75KjQ1ixzFzGmEN8FEtdSWqio5Hp3vSgVFwWAG/RGagVxUf4bw3syjxe2wPVdiXpIrv0XMA/2tQ==` | `57f126ee4ae5d435938569ad22c489e4a0262ca2` |

All five package records declare MIT. Preserve the exact package-lock integrity and select the router generation
explicitly.

The SDK may default to an older router encoding when a generation is omitted. Fail closed instead of guessing.

Routing, discovery, indexing, and intent settlement are separate integration layers. Their repositories are evidence
about code and documented behavior, not proof that the hosted interface or Trading API currently supports a particular
hook:

| Source | Observed head | License evidence | Boundary |
| --- | --- | --- | --- |
| `Uniswap/docs` | `a0da460b1becfe920330adfab5d11f2f3f63863a` | MIT | Published documentation source; live policy and API pages still need dated observations |
| `Uniswap/uniroute-public` | `3cce57b8ad8aae7ffa72d4947c535321ada60486` | No license file; README-only MIT claim | Public offchain routing core with placeholder configuration, not the hosted production service |
| `Uniswap/onchain-router` | `b01c21e64ae899a8410df91370ab647b1ecec33a` | No repository license; mixed file-level identifiers | Separate constrained onchain router, not Universal Router or a general hooked-pool compatibility layer |
| `Uniswap/v4-subgraph` | `0c13ab2fbd95306272528ed781511d7e2aa338d3` | GPL-3.0 | Event indexer; indexed does not mean quoted, executable, verified, or approved |
| `Uniswap/UniswapX` | `3f5019cf206bc2b37a47c7653f039914f93ad60d` | GPL-3.0 | Intent settlement; permissionless filling does not grant the permissioned quoter role |
| `Uniswap/ignite` | `77963ec737be39217c4c16284f13d621b356001f` | MIT | Optional local visual deployment tool; never run it automatically or treat it as protocol authority |
| `Uniswap/continuous-clearing-auction` | `6c9e559e63a7a141a4fe4bd5aa0f47fee1354b58` | MIT | Official CCA implementation reference; it does not make every launch model an auction |
| `Uniswap/URCs` | `c8ed8f5099f32d0e016ede06a234267f0e33cab6` | CC0-1.0 | Standards registry; only a Final URC is normative, and URC-4 remains Discussion here |

The observed public Trading API OpenAPI document is pinned by SHA-256 in the JSON snapshot. Ignore operations and
fields marked `x-internal: true`. `V4_HOOKS_INCLUSIVE`, `V4_HOOKS_ONLY`, and `V4_NO_HOOKS` select a quote search mode;
they do not prove allowlisting or execution. An API key authenticates an integrator, not a hook.

The reviewed UniRoute advance from `beaab6050068be2efa329ce9fbcf76d3a14dabe7` to
`3cce57b8ad8aae7ffa72d4947c535321ada60486` is a four-commit fast-forward. It adds five Robinhood hook addresses to the
public allowlist, documents one as exact-input-only, removes one Celo gas-token candidate, and introduces configurable
negative-token and block-number caches. An explicitly requested block bypasses the block-number cache. Because the
published configuration values are placeholders, this is source evidence about possible routing admission and quote
freshness behavior, not proof of a deployed cache policy, hosted allowlist, route, audit, or approval. Retain exact-input
and exact-output parity tests and bind live quote observations separately.

The observed SDK monorepo head is `a7ee2dbf78287d948189c47b4e58a1eadca430bd`. It is not a package lock; retain the
version, integrity, and release `gitHead` in the table above. The observed Universal Router head is
`fa3f856951967abd7e0cf33901f6cead31eb5469` and directly locks
`v4-periphery@9dafaaecc1e2e1e824eda9d941085f96517d827b` plus
`permit2@cc56ad0f3439c502c246fc5cfcc3db92bb8b7219`. It is GPL-3.0 and remains research until an exact deployed generation
is independently bound to source, address, runtime hash, and interfaces.

### Deployments

Resolve live addresses from the official human deployment page and machine feed, then confirm chain ID, active status,
explicit version, bytecode, and required interface through RPC. Store feed timestamp, feed source revision, explorer URL,
and observed runtime hash.

Do not hardcode a newly observed address into generated source or documentation as a permanent truth.

The observed `Uniswap/contracts` registry head is `d47f0f73407c1b0b9d8959bf460a612cdc4a516e`, but the bundled deployment
snapshot was generated from `37936185dee7decf681360ec799c124e0e034672`. Keep the snapshot bound to that producer
commit. Current registry HEAD is not retroactive deployment provenance. The registry has no detected repository license;
consume its data without copying unlicensed code or prose.

Preserve the feed's `sourceRepo`, `sourceRef`, and `sourceCodeUrl` separately. The feed can name `v4-core` while its
source URL points to an implementation in `v4-periphery`, and several short source references do not resolve as commits
in the named implementation repository. The bundled snapshot therefore records an implementation repository and an
explicit `resolved`, `unresolved`, or `ambiguous` source-ref state. It proves an official address record, not source or
runtime identity. An ambiguous generation fails closed; an unresolved one still needs independent explorer and RPC
evidence before any release claim.

### Hooklist

Reuse deterministic permission decoding, proxy resolution, verified-source intake, untrusted-source handling, structured
classification, CI validation, and human review. Hooklist inclusion is neither an audit nor routing approval.

Do not copy maintainer-specific automation, identities, local paths, merge instructions, or unlicensed prose.

## Official AI resources

The skill may consult the exact pinned Uniswap AI resources:

- v4 Hook Generator
- v4 Security Foundations
- v4 SDK Integration
- swap and liquidity planning resources
- agent-agnostic writing conventions

The observed Uniswap AI source is `9660491dc662fea76c2f8565c2f7ba2abf6e8840`. The Uniswap AI Toolkit pin is
`9b405c71e42d0cec4026f2c158edf99716600baa` on its `next` default branch, replacing the previously observed
`bb873ee808564ed0c917b156b651f4ddda43a4c2`. The one-commit fast-forward replaces ai-toolkit's own PR review path with
the shared `@uniswap/review-cli`, adds repository-specific workflow-security and plugin-convention reviewers, restricts
comment-triggered reviews to trusted associations, keeps external consumers on the unchanged reusable workflow, and
loads credentialed review tooling from the trusted default branch rather than PR-head code. These are useful workflow
security precedents, but the toolkit is general agent-development tooling, not a source of protocol truth. Protocol-
specific v4 hook generation, security, SDK, and evaluation guidance remains in `Uniswap/uniswap-ai`.

Reuse their hook-type discovery, permission questionnaire, official generation schema, and security-companion pattern.
Replace these gaps:

- Generated source without compile and lifecycle proof
- Prompt-only evaluations instead of Solidity tests
- Stale BaseHook or HookMiner locations
- Missing Programmable token, trust, routing, provenance, and release gates
- Platform-specific frontmatter and automatic tool permissions

Uniswap's AI spec workflow can inspire requirements/design/tasks separation. Do not adopt autonomous self-approval or
instructions that bypass human review. Smart-contract acceptance and external actions require accountable human gates.

## Update procedure

An upstream refresh is a review task:

1. Run `node scripts/check-upstream-drift.mjs` from the skill root. It uses only public GitHub metadata and the official
   feeds recorded in the snapshot; each request has a ten-second timeout, redirects are rejected, response sizes are
   bounded, and the checker has no authentication, write, signing, or secret path.
2. For a network-free review, pass `--observations <path>`. The file contains `repositories` entries with
   `repository`, `defaultBranch`, `ref`, `commit`, `archived`, and `license`, plus `feeds` entries with `url` and
   `sha256`, exact `deploymentRecords` copied from the already obtained official feed for every committed launchpad
   record, and `sourceArtifacts` entries with each immutable source URL and SHA-256. Add `--json` for stable
   machine-readable output. The committed deployment-reference SHA-256 is checked before either live or offline
   comparison, so local package verification remains deterministic and network-free.
3. Read the official release notes, source diff, license, compiler, and dependency changes for every finding.
4. Update the observed snapshot only. Never auto-accept a moved ref, new repository, changed license, or feed hash.
5. Run the skill's source and reference checks.
6. Test a coherent candidate dependency set in an isolated worktree.
7. Run the full repository and model-specific test matrix.
8. Record incompatibilities, migrations, and security assumptions.
9. Change the Programmable-tested baseline only in a separately reviewed release.

The checker exits 0 when clean, 1 when reviewed drift exists, and 2 for invalid input or unavailable live evidence.
Never overwrite deployed-release provenance to make it look current.

## Primary URLs

- [Uniswap v4 core](https://github.com/Uniswap/v4-core)
- [Uniswap v4 periphery](https://github.com/Uniswap/v4-periphery)
- [Uniswap v4 hooks public](https://github.com/Uniswap/v4-hooks-public)
- [Uniswap documentation source](https://github.com/Uniswap/docs)
- [Uniswap hook routing policy](https://developers.uniswap.org/hook-allowlist)
- [Uniswap integrated hook routing](https://developers.uniswap.org/docs/protocols/v4/concepts/hook-routing)
- [Uniswap UniRoute public](https://github.com/Uniswap/uniroute-public)
- [Uniswap Onchain Router](https://github.com/Uniswap/onchain-router)
- [Uniswap v4 subgraph](https://github.com/Uniswap/v4-subgraph)
- [Uniswap Trading API OpenAPI](https://trade-api.gateway.uniswap.org/v1/api.json)
- [UniswapX](https://github.com/Uniswap/UniswapX)
- [Uniswap Ignite](https://github.com/Uniswap/ignite)
- [Uniswap Continuous Clearing Auction](https://github.com/Uniswap/continuous-clearing-auction)
- [Uniswap Request for Comments](https://github.com/Uniswap/URCs)
- [Uniswap Liquidity Launcher](https://github.com/Uniswap/liquidity-launcher)
- [Uniswap UERC20 Factory](https://github.com/Uniswap/uerc20-factory)
- [Uniswap SDKs](https://github.com/Uniswap/sdks)
- [Uniswap Universal Router](https://github.com/Uniswap/universal-router)
- [Uniswap v4 template](https://github.com/Uniswap/v4-template)
- [Uniswap contracts deployment registry](https://github.com/Uniswap/contracts)
- [Uniswap Hooklist](https://github.com/Uniswap/hooklist)
- [Uniswap deployments](https://developers.uniswap.org/deployments)
- [Uniswap deployment feed](https://developers.uniswap.org/deployments.json)
- [Uniswap AI](https://github.com/Uniswap/uniswap-ai)
- [Uniswap AI Toolkit](https://github.com/Uniswap/ai-toolkit)
- [Ethereum EIPs](https://github.com/ethereum/EIPs)
- [Ethereum ERCs](https://github.com/ethereum/ERCs)
- [Ethereum execution specifications](https://github.com/ethereum/execution-specs)
- [Solidity compiler](https://github.com/argotorg/solidity)
- [Uniswap Foundation foundational hooks](https://github.com/UniswapFoundation/foundational-hooks)
- [Uniswap Foundation scaffold hook](https://github.com/UniswapFoundation/scaffold-hook)
- [Uniswap Foundation v4 by Example](https://github.com/UniswapFoundation/v4-by-example)
- [Uniswap Foundation HookRegistry](https://github.com/UniswapFoundation/HookRegistry)
- [Uniswap Foundation router rebates](https://github.com/UniswapFoundation/router-rebates)
- [OpenZeppelin Uniswap hooks](https://github.com/OpenZeppelin/uniswap-hooks)
- [OpenZeppelin Uniswap Hooks documentation](https://docs.openzeppelin.com/uniswap-hooks)
- [OpenZeppelin Contracts access control](https://docs.openzeppelin.com/contracts/5.x/access-control)
- [OpenZeppelin Contracts Wizard](https://github.com/OpenZeppelin/contracts-wizard)
- [OpenZeppelin Uniswap Hooks audits](https://github.com/OpenZeppelin/uniswap-hooks/tree/26dc8e53f812a1ca390d470342adb6cd8c3286ad/audits)
- [Uniswap Foundation Hooks Security Framework](https://github.com/uniswapfoundation/security-framework)

## License boundary

Check the license of every file, not only the repository banner. Import pinned packages instead of copying protocol
implementations. Preserve compatible notices. Do not copy unlicensed security-framework or Hooklist prose wholesale.
Do not vendor UniRoute from a README-only license claim, Onchain Router from mixed file headers, or Briefcase and
Hooklist from package or repository metadata without an effective grant covering the reused material. Audit reports
apply only to their exact reviewed commit and scope.
