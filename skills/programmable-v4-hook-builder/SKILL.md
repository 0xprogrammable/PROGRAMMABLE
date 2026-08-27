---
name: programmable-v4-hook-builder
description: Build, repair, validate, submit, or track a complete Programmable Uniswap v4 Custom launch through the public V3 API. Use when the user names Programmable and wants implementation or launch work for a hook, token, multi-contract graph, app, game, service, or hybrid. Do not use for explanation-only questions, unrelated Solidity work, generic Uniswap research, or legacy GitHub submission intake.
---

# Programmable V4 Hook Builder

Use the public V3 machine contract to turn an exact project revision into a deterministic launch request. Do not use
the retired Registry or GitHub submission intake. Do not infer that installation, validation, submission, wallet
broadcast, finality, indexing, or source verification are the same state.

## Establish the current public contract

Before changing the project or asking for a secret:

1. Fetch `https://programmable.market/.well-known/programmable.json`.
2. Follow `customLaunchApi.agentIntegration` to the advertised remediation catalog, pack-config schema, guide,
   OpenAPI document, capabilities route, and immutable CLI release.
3. Verify the CLI tarball with its published checksum sidecar before installation.
4. Fetch unauthenticated `GET https://api.programmable.market/v3/capabilities`.
5. Stop if the profile ID, revision, version, production authorization, routes, scopes, authentication boundary, or
   wallet-handoff base differs from the installed CLI contract. Never downgrade or improvise around drift.

Authenticated CLI traffic is fixed to exact origin `https://api.programmable.market`. There is no origin override.
Tests use an injected transport and never redirect a production API key.

Read [references/public-v3-contract.md](references/public-v3-contract.md) before editing or submitting a project.

## Build the exact project

Inspect the repository's instructions and preserve unrelated work. Pin one public source revision containing the exact
submitted bytes. Build the real graph rather than fitting the project into a sample architecture.

Collect and bind:

- project name, token symbol, description, an exact source-bound image, and sorted canonical public links;
- exact Solidity Standard JSON source content and matching compiler output;
- full solc version, optimizer and EVM settings, libraries, ABI, creation/runtime bytecode, metadata, and constructor
  or initializer arguments;
- every direct CREATE2 target and dependency edge in the launch graph;
- the real v4 hook permission mask and concrete reachable implementation for each enabled callback;
- funding mode, initial-liquidity model, custody, withdrawal path, lock evidence, LP fee, project fee, and the required
  Programmable 10 bps accounting disclosure;
- evidence for every check claimed by the request.

Do not hand-write a derived digest, address, locator, CREATE2 prediction, graph commitment, or verification hash. The
CLI derives these from exact files. Do not claim a check passed without its underlying evidence.

## Use the deterministic state machine

The only command order is:

```text
pack
validate --remote
submit
status --watch --until authorized
wallet
status --watch --until finalized
```

`wallet` is not a CLI command. It is a stop for the connected controller to inspect and separately sign the exact
website handoff. Some EIP-3009 launches stop first at `awaiting_funding_authorization`; complete only that exact typed
data signature in the website, poll again, then stop separately for the Router transaction at `authorized`.

The CLI must:

- read the API key only from `PROGRAMMABLE_API_KEY` or the supported operating-system secret store;
- preserve byte-identical request bytes and the same durable Idempotency-Key across retries;
- honor `Retry-After` on `429` and `503`;
- stop on terminal states;
- never request a private key, sign, or broadcast.

Server-side exact-source static admission and the final Router simulation are authoritative for launch admission.
Local packager or model checks are preparation, not the final decision. Never describe either layer as an audit or a
guarantee of safety, liquidity, tradeability, honeypot resistance, or later fee behavior.

## Handle results precisely

- `pending_review`: continue single-resource status polling.
- `action_required`: read the typed finding and remediation; change the exact source or evidence, then create a new
  pack. Do not bypass the finding.
- `awaiting_funding_authorization`: stop for the exact website funding-signature handoff.
- `authorized`: stop for controller review of chain, sender, Router, value, selector, calldata, and metadata.
- `submitted`: poll the same resource; a transaction hash alone is not finality.
- `finalized`: report the onchain launch separately from indexing and exact-source verification.
- `failed` or `cancelled`: stop and report the durable error code and request ID without exposing the API key.

Never claim universal hook compatibility. The public profile supports project-owned multi-contract graphs and all
fourteen permission bits structurally, but the exact build can still be unsupported, need evidence, fail simulation,
or require project changes. Normal pool initialization does not add initial liquidity; custom accounting or
launch-seeded liquidity must be implemented and disclosed by the project.

## Verification and handoff

Run focused project tests, deterministic pack, local validation, remote preflight, and `git diff --check`. For a
no-broadcast rehearsal, stop before `submit`. For a real submission, give the user the request ID, current durable
state, and safe wallet-handoff URL only when returned by that exact resource.

Do not call work live from local checks, CI, a prepared response, or HTTP 200. Separate source revision, CLI artifact,
server admission, wallet action, onchain finality, discovery/indexing, and exact-source provider state in the final
handoff.

## Maintainer-only resources

`references/eval-corpus.md` is the forward-trigger and adversarial evaluation set for skill maintainers; it is not a
runtime instruction. The following files belong to the retired GitHub intake and must not be read or invoked for a V3
launch: `scripts/application-input-contract.mjs`, `scripts/autonomous-admission-contract.mjs`,
`scripts/cli-runtime.mjs`, `scripts/github-exact-object-resolver.mjs`, `scripts/github-public-source-core.mjs`,
`scripts/official-launchpad-core.mjs`, `scripts/package-dependency-contract.mjs`, `scripts/public-claims-core.mjs`,
`scripts/review-target-contract.mjs`, and `scripts/submission-core.mjs`.
