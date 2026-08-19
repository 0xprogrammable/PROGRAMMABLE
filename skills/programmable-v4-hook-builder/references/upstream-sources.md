# Upstream source policy

The current source and package snapshot was observed on `2026-08-07T08:39:02Z` and is recorded in
[upstream-snapshot-2026-08-07.json](upstream-snapshot-2026-08-07.json). The larger historical inventory below began
on 2026-08-01 and includes reviewed drift through 2026-08-03; feed and package records retain their own observation and
release timestamps. A newer observed head is never silently treated as reviewed or compatible.

Official code is a source, not an automatic compatibility guarantee. Use exact revisions and test the complete version
set together.

The machine-readable snapshot is [upstream-sources.json](upstream-sources.json), and the exact reviewed ranges, changed
files, impact decisions and adopted guidance are closed by
[upstream-reviewed-drift-v1.json](upstream-reviewed-drift-v1.json). Use
[routing-and-discovery.md](routing-and-discovery.md) before making listing, indexing, quote, routing, interface, or
provider-approval claims.

## Current compatibility lanes

The 2026-08-07 snapshot separates five lanes instead of pretending that repository heads form one stack:

- stable Solidity candidate: `@uniswap/v4-core@1.0.2`, `@uniswap/v4-periphery@1.0.3`, Permit2
  `cc56ad0f3439c502c246fc5cfcc3db92bb8b7219`, solc `0.8.26`, Cancun and via-IR;
- stable TypeScript candidate: `@uniswap/v4-sdk@2.3.1`, `@uniswap/sdk-core@7.19.0`,
  `@uniswap/universal-router-sdk@5.11.2` and `@uniswap/permit2-sdk@1.4.0`;
- OpenZeppelin hook candidate: `@openzeppelin/uniswap-hooks@1.1.1`, `@openzeppelin/contracts@5.5.0`, core `1.0.2`
  and periphery `1.0.3` with exact registry integrities;
- local Fee V2 router evidence: OpenZeppelin Contracts `5.6.1` and Hooks `1.1.1`, core `1.0.2`, periphery `1.0.3`,
  Universal Router `2.1.0`, Router SDK `5.11.2`, v4 SDK `2.3.1`, Permit2 `cc56ad0...`, and Solmate Permit2
  `8d910d8...`, bound by lock SHA-256 `e73b8f213af284c54550e7bdf5416e9bf1f17774b4f6e23d3bb8f6a150ede759`;
- current-source canary: the recorded repository heads, tested together in isolation before promotion.

Candidate lanes are only lock-compatible until the Builder has executed installation, compilation, unit, negative,
fuzz, invariant, fork, router and deployment-bytecode checks. The pinned Fee V2 kernel's local campaign covers 2/2 SDK
tests and 58/58 Forge tests, including eight ERC-20/native buy/sell exact-input/exact-output modes that quote through the
real pinned V4Quoter and execute immediately through the real pinned Universal Router with Permit2 or native funding.
That is deterministic local simulation against one in-process PoolManager, not a provider quote, pinned fork, deployed
runtime, broadcast transaction, hosted route, approval or production evidence. Its exact offline SDK tree retains
10 high, 9 moderate and 17 low transitive advisories; that is a recorded limitation, not remediation or production-runtime approval.
Universal Router `2.2.0` is a GitHub source release while npm latest remains
`2.1.0`; OpenZeppelin Contracts `5.7.0` is a GitHub release but npm `dev`; OpenZeppelin Hooks `1.2.1` is a prerelease/dev
artifact. These mismatches are evidence, not upgrade permission.

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

- `v4-periphery@545a5d2a87228167edde48f3b9eda122d1e3c4d6` locks
  `v4-core@59d3ecf53afa9264a16bba0e38f4c5d2231f80bc`.
- `v4-hooks-public@7da5210f2c81a700820a6b4f585264233d91f349` has repository gitlinks to
  `v4-core@d153b048868a60c2403a3ef5b2301bb247884d46` and
  `v4-periphery@76c1891c481cebb4ff58f262473303f01a2d7393`. Its `foundry.lock` instead records
  `v4-periphery@3779387e5d296f39df543d23524b050f89a62917`.

Preserve both forms of evidence. The hooks-public mismatch is upstream drift, not a resolved dependency profile. Do not
combine either observed set with the independently observed v4-core head or generate from it without selecting and
testing one coherent checkout explicitly.

The reviewed periphery range `3245c3cb99c48fa1dc2459c3b60abc37d4294aba..545a5d2a87228167edde48f3b9eda122d1e3c4d6`
makes exact-output routing all-or-nothing at every hop. This matters when a route repeats a currency: PoolManager's final
currency netting can otherwise hide an underfilled intermediate hop. Adopt the full-fill invariant and its regression
shape, but do not treat the observed head as the Programmable-tested periphery baseline.

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
swap is exact-input or exact-output. Require a complete supported/rejected four-quadrant matrix and disclose the
resulting asset for every supported mode. Enforce an
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

Trade capability is a first-class Builder contract. Applicability is exactly `tradable`, `no-market`, or `unresolved`.
`no-market` and `unresolved` emit no selected route, trade manifest, quote result, or execution result, and unresolved
projects cannot complete. Every selected tradable market binds one `standard-uniswap-v4` or
`canonical-programmable-adapter` manifest with PoolKey, router/quoter/Permit2 requirements, hook data, directions,
exactness, slippage/deadline and fee behavior. Every manifest remains `NOT_APPROVED`; typed command results are bounded
local evidence, never provider, deployment, signing, broadcast, audit, approval or live-tradability evidence.

Routing, discovery, indexing, and intent settlement are separate integration layers. Their repositories are evidence
about code and documented behavior, not proof that the hosted interface or Trading API currently supports a particular
hook:

| Source | Observed head | License evidence | Boundary |
| --- | --- | --- | --- |
| `Uniswap/docs` | `a0da460b1becfe920330adfab5d11f2f3f63863a` | MIT | Published documentation source; live policy and API pages still need dated observations |
| `Uniswap/uniroute-public` | `0e002a0bcb35624df416a9bba7705aef66eb2c52` | No license file; README-only MIT claim | Public offchain routing core with placeholder configuration, not the hosted production service |
| `Uniswap/onchain-router` | `b01c21e64ae899a8410df91370ab647b1ecec33a` | No repository license; mixed file-level identifiers | Separate constrained onchain router, not Universal Router or a general hooked-pool compatibility layer |
| `Uniswap/v4-subgraph` | `0c13ab2fbd95306272528ed781511d7e2aa338d3` | GPL-3.0 | Event indexer; indexed does not mean quoted, executable, verified, or approved |
| `Uniswap/UniswapX` | `3f5019cf206bc2b37a47c7653f039914f93ad60d` | GPL-3.0 | Intent settlement; permissionless filling does not grant the permissioned quoter role |
| `Uniswap/ignite` | `77963ec737be39217c4c16284f13d621b356001f` | MIT | Optional local visual deployment tool; never run it automatically or treat it as protocol authority |
| `Uniswap/continuous-clearing-auction` | `6c9e559e63a7a141a4fe4bd5aa0f47fee1354b58` | MIT | Official CCA implementation reference; it does not make every launch model an auction |
| `Uniswap/URCs` | `c8ed8f5099f32d0e016ede06a234267f0e33cab6` | CC0-1.0 | Standards registry; only a Final URC is normative, and URC-4 remains Discussion here |

The observed public Trading API OpenAPI document is pinned by SHA-256 in the JSON snapshot. Ignore operations and
fields marked `x-internal: true`. `V4_HOOKS_INCLUSIVE`, `V4_HOOKS_ONLY`, and `V4_NO_HOOKS` select a quote search mode;
they do not prove allowlisting or execution. An API key authenticates an integrator, not a hook.

The latest reviewed UniRoute advance is
`2cf851e7bb5ed0e722da9edc027aeeafae525f38..0e002a0bcb35624df416a9bba7705aef66eb2c52`; its only source change is the
Robinhood-V4 Aurora pool-cache path and its tests. When exactly one pool side has a fresh price and that priced side is
native currency, wrapped native, or USDG, the path may value the other reserve from the pool's own spot price. It caps
the added ranking TVL at one native unit per pool and separately compares the pools left after the serving hook filter.
This can keep a fresh launchpad pool visible while its new token lacks a price row, but spot-derived admission remains
attacker-influenced and the cap is not price-or-liquidity verification. The range changes no dependency manifest,
lockfile, gitlink, deployment record, Ethereum path, or hosted configuration.

The preceding reviewed range
`3cce57b8ad8aae7ffa72d4947c535321ada60486..2cf851e7bb5ed0e722da9edc027aeeafae525f38` added eleven Robinhood hook
addresses to a source allowlist, while an earlier range introduced configurable negative-token and block-number caches
and exactness-specific routing behavior. Because published configuration values remain placeholders, all of these are
source evidence about possible discovery, routing admission, parity, and quote freshness—not proof of a deployed cache
policy, hosted allowlist, route, audit, or approval. Retain exact-input and exact-output parity tests and bind live quote
observations separately.

The observed SDK monorepo head advanced from `1e30c3265f3cfb818ed912833f3e65630c8b3490` to
`d4e9116c61b9e39c74c5704d0224d91ff55d34d3`. The reviewed two commits change only liquidity-launcher-sdk strategy
generation records and its release version; the `@uniswap/v4-sdk` package remains `2.3.1`. Monorepo HEAD is not a
package lock: retain each tested package's version, integrity, release `gitHead`, and compatibility evidence from the
table above.

The latest observed Universal Router range is
`9e9a780a3c17b61fc78a1a73c85684859dda1bad..d203e7f5525aeae385800f9490b93886711701df`. Its direct gitlinks remain
`v4-periphery@363226d9e1e2180b67bf6857023dbaad751010c5` and
`permit2@cc56ad0f3439c502c246fc5cfcc3db92bb8b7219`; these observed edges are not the tested Programmable baseline or a
resolved cross-repository compatibility set. The latest source bounds router command input decoding before static-head,
dynamic-offset, array-length, length-multiplication and short-selector reads; it changes `SWEEP.amountMin` to `uint256`,
adds `UNWRAP_WETH_EXACT`, and requires signed-route hooks to authenticate both PoolManager as callback caller and
Universal Router as callback sender. The preceding range added the already-unlocked PoolManager path. The router's own
periphery gitlink does not contain sibling periphery head `545a5d...`, so do not infer the exact-output full-fill fix from
this router head. No deployment, provider route, release, runtime hash, interface or production support is established.

### Deployments

Resolve live addresses from the official human deployment page and machine feed, then confirm chain ID, active status,
explicit version, bytecode, and required interface through RPC. Store feed timestamp, feed source revision, explorer URL,
and observed runtime hash.

Do not hardcode a newly observed address into generated source or documentation as a permanent truth.

The latest observed `Uniswap/contracts` range is
`580e74a1e1bced14c09ab66f9e6d7e3ebdd61ac4..0ecb1fcaed7cf36b3f33524e09c07efe5387f9b5`; it changes only the
Universal Router gitlink to `d203e7f5525aeae385800f9490b93886711701df` and the v4-periphery gitlink to
`545a5d2a87228167edde48f3b9eda122d1e3c4d6`. These sibling edges are not a compatibility claim: Universal Router itself
still pins v4-periphery `363226d9e1e2180b67bf6857023dbaad751010c5`. The bundled deployment snapshot and
unchanged observed deployment-feed hash remain bound to feed-producing commit
`37936185dee7decf681360ec799c124e0e034672`. A registry source-head or submodule update is not retroactive deployment
provenance. The registry has no detected repository license; consume its data without copying unlicensed code or prose.

Preserve the feed's `sourceRepo`, `sourceRef`, and `sourceCodeUrl` separately. The feed can name `v4-core` while its
source URL points to an implementation in `v4-periphery`, and several short source references do not resolve as commits
in the named implementation repository. The bundled snapshot therefore records an implementation repository and an
explicit `resolved`, `unresolved`, or `ambiguous` source-ref state. It proves an official address record, not source or
runtime identity. An ambiguous generation fails closed; an unresolved one still needs independent explorer and RPC
evidence before any release claim.

### Hooklist

Reuse deterministic permission decoding, proxy resolution, verified-source intake, untrusted-source handling, structured
classification, CI validation, and human review. Hooklist inclusion is neither an audit nor routing approval.

The reviewed range `8488c73fd6042a0d37b3312e9f9b74e8d5ced71d..43ca58a8ca62bb950a1b1f01ef23929bd86b8943`
adds registry entries on BNB, Ethereum and Robinhood. Treat them as discovery data only.

Do not copy maintainer-specific automation, identities, local paths, merge instructions, or unlicensed prose.

## Official AI resources

The skill may consult the exact pinned Uniswap AI resources:

- v4 Hook Generator
- v4 Security Foundations
- v4 SDK Integration
- swap and liquidity planning resources
- agent-agnostic writing conventions

The observed Uniswap AI head is `86820b932572c4f6dd70116061bc6d67680bd108`. Its reviewed range changes only review
automation; all eight blobs bound in the historical evaluation source receipt remain unchanged, so that receipt stays
at `9660491dc662fea76c2f8565c2f7ba2abf6e8840`. The observed AI Toolkit head is
`f0812c1d0a52ef4bcbda873d2e7eefa374a3fcf6` on `next`. Its reviewed range changes general workflow, release and plugin
guidance and adds a backtest-change skill. These are useful agent-workflow precedents, not protocol truth. Protocol-
specific v4 hook generation, security, SDK and evaluation guidance remains in `Uniswap/uniswap-ai`.

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
