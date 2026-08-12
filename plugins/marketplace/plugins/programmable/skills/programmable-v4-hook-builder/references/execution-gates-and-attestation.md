# Execution gates, review independence, and attestation

Use this policy for Prototype, Review, Submit, Handoff, and every later platform deployment design. It strengthens the
evidence boundary; it does not authorize this skill to sign, broadcast, deploy, approve, or publish anything.

## Research provenance and adoption boundary

This policy incorporates general operational patterns independently reviewed in
[`aeonfun/aeon`](https://github.com/aeonfun/aeon/tree/8ffcb571c2fe3a31b6b3d6edf9838a79f7679257), numeric repository id
`1172886754`, commit `8ffcb571c2fe3a31b6b3d6edf9838a79f7679257`, root tree
`f4d28fa129bb3c95d19de6bc0916dcced6f8e9ac`, MIT license, observed 2026-08-06. The relevant reviewed materials were
`skills/deploy-uni-hook/`, `skills/skill-health/`, `skills/skill-repair/`, `skills/vuln-scanner/`, and
`docs/attestation.md`.

Only the reusable methods below are adopted. No AEON Solidity, shell script, chain registry, deployment address,
template, fee rule, audit claim, or broadcast authority is incorporated. AEON is a research input, not a Programmable
dependency, compatibility baseline, security reviewer, or approval source.

## Non-negotiable separation of states

Model the release path as separate, monotonic states. Every transition binds the same immutable review target and has
its own authority and evidence.

| State | Required result | Authority |
| --- | --- | --- |
| Prepare | Exact source, build closure, launch graph, predicted addresses, postconditions, and rollback limits | Applicant and review tooling |
| Analyze | Applicable static, semantic, fuzz, invariant, dependency, and source checks with explicit tool outcomes | Applicant plus independent reviewer reproduction |
| Simulate | Exact target-chain transactions against a pinned fork and a separately refreshed current head | Review tooling; never a deployment authority |
| Authorize | Human-owned typed authorization binds chain, target, signer policy, limits, expiry, and simulation digest | Programmable maintainer process only |
| Broadcast | Authorized transaction bytes are signed and sent once under nonce, fee, value, and destination limits | Separately controlled platform signer only |
| Verify | Receipts, runtime, source, configuration, PoolKey, permissions, fees, claims, liquidity, and lifecycle match | Maintainer-owned verification |
| Activate | Product, monitoring, routing, discovery, and provider gates are complete | Separate maintainers and providers |

The Builder stops before `Authorize`. A successful build, test, static scan, fork simulation, source verification, or
attestation cannot skip a state or imply a later one.

## Deployment-control contract for later platform implementation

The future deployment rail must default to planning or simulation. Mainnet execution requires all three independent
conditions at the moment of use:

1. the exact immutable target has a valid signed final-verification record;
2. the exact chain and complete transaction bundle are explicitly authorized with limits and expiry; and
3. the operator-controlled deployment rail is enabled for that chain and signer policy.

Also require:

- a gas-only signer that never owns launch liquidity, treasury assets, fee liabilities, LP positions, or upgrade/admin
  authority;
- signer isolation through a signing service or hardware-backed boundary; never place private keys, tokens, RPC
  credentials, or signing material in command arguments, repository files, artifacts, logs, prompts, or reports;
- chain-id confirmation from the signed payload and at least one independent RPC read before signing;
- maximum native value, gas limit, priority fee, total fee, target address, selector, nonce range, deadline, and retry
  limits;
- authenticated RPC preference, named RPC class, independent receipt/runtime reconciliation, and fail-closed behavior
  on disagreement, stale state, reorg risk, or unavailable data;
- an idempotency key derived from review-target digest, chain id, deployment graph, transaction bundle, and authorization;
- cooldown and duplicate-intent controls that cannot replace onchain nonce and address/runtime checks; and
- no automatic continuation after a partial non-atomic launch. Recompute state, match every completed postcondition,
  and obtain a fresh bounded authorization for the remaining exact actions.

For CREATE2 occupancy, code at the predicted address is not enough to conclude `already deployed`. Match the expected
runtime, immutable configuration, deployer, initcode-derived identity, permissions, PoolManager, PoolKey binding, admin
surface, and prior receipt. Foreign or merely interface-compatible code fails closed.

## Tool coverage and result taxonomy

Create a tool-coverage matrix before calling A10 complete. Each applicable tool or method records one of:

- `passed`: the exact command completed and attributable output supports the named scope;
- `failed`: the tool completed and found a reproducible conflict or the tested property failed;
- `tooling-blocked`: the intended tool could not run because of environment, parser, service, quota, or installation;
- `no-data`: the run completed but returned no usable result for the required scope;
- `not-applicable-with-reason`: a structural argument or test proves the capability is unreachable; or
- `inconclusive`: output exists but cannot support a pass or fail conclusion.

Never collapse these states into a boolean. All scanners unavailable, all parsers failing, or an empty report is not a
clean result. It is missing or blocked evidence. A scanner hit is a candidate finding, not a vulnerability: trace
attacker control, reachable state, value or authority impact, and the smallest reproduction before calling it a hard
security defect.

For intermittent failures, inspect at least the last five comparable exact-target runs when available. Cluster by a
normalized signature that removes timestamps, run ids, temporary paths, addresses, and other incidental noise. Record
whether the failure is deterministic, intermittent, target-specific, tool-specific, or systemic. Never let a later
green retry erase an attributable earlier failure without explaining the cause and invalidation.

## Independent evidence

Independence is about control and method, not file count.

- Code and tests generated by the same agent in one run are useful builder evidence, but not independent confirmation.
- A one-swap fork rehearsal proves only that exact path; it does not prove all v4 quadrants, return-delta conservation,
  cumulative fees, claims, custody, failure recovery, or launch safety.
- Regex or token-presence checks may route review, but cannot prove permission correctness, authentication, dataflow,
  settlement, absence of dangerous behavior, or an audit result.
- Static analyzers complement semantic tests and manual review. One cannot silently substitute for the other.
- At least one maintainer-controlled clean-clone reproduction must rebuild the bound target and rerun the risk-triggered
  semantic suite before a positive final-verification decision.
- High-risk accounting, custody, upgrade, bridge, proof, custom-curve, or return-delta paths retain their specialist or
  independent-review requirements even when all local tools pass.

Record who authored code, authored tests, chose assertions, ran each tool, interpreted findings, and reproduced the
result. A changed prompt, model, tool, ruleset, dependency database, or suppression file is an evidence input and may
invalidate the result.

## Run-scoped evidence and attestation

An attestation proves provenance of exact bytes under an identified workflow. It does not prove that the bytes are
correct, complete, safe, audited, approved, deployed, or launchable.

Evidence that crosses the trust boundary must use a unique immutable run-scoped subject, never a shared mutable
`latest` path. Bind at minimum:

- review-target digest, primary and companion repository ids, commits, trees, and retained source-bundle digest;
- workflow/service identity and revision, trigger, run id, attempt, actor class, timestamp, and environment image;
- skill, criteria, fee-policy, package-contract, validator, scanner rules, suppression, and dependency-database digests;
- compiler, build configuration, dependency closure, commands, exit codes, outcome taxonomy, counts, skips, and failures;
- artifact paths, media types, sizes, sha256 digests, and the digest of the manifest that lists them;
- signer identity, signature scheme, transparency or retention reference when used, and verification result; and
- superseded record id plus the explicit reason every earlier result is retained, invalidated, or still applicable.

Concurrent runs must never overwrite one another's attested subject. Verify the signature, subject digest, workflow
identity, source identity, and policy digests before consuming a record. A valid signature over incomplete, stale, or
malicious output remains valid provenance for bad evidence and must not become a green security result.

The future final-verification record must be typed, signed, immutable, single-target, time-bounded where operationally
needed, and consumed directly by the launch system. GitHub comments, labels, aggregate review state, editable status
text, screenshots, or attested free-form prose are projections only.

## Minimum red-team cases

Add these cases whenever their corresponding layer exists:

1. Remove every scanner or make every tool return empty output; A10 cannot become passed.
2. Feed generated code only its same-run generated tests; independent-review state stays incomplete.
3. Change one assertion, suppression, tool version, prompt, policy digest, or dependency database; dependent evidence
   invalidates.
4. Reuse a valid attestation with changed source, manifest, artifact bytes, workflow identity, or review target; reject.
5. Race two runs that write the same human-facing output; each immutable run subject still verifies independently.
6. Reuse a deployment authorization on another chain, target, bundle, nonce range, signer, or after expiry; reject.
7. Simulate successfully, then change current head, RPC result, gas bounds, transaction bytes, or predicted-address
   occupancy before signing; require a fresh simulation or authorization as applicable.
8. Put a secret in an environment value and pass it as a command argument; the secret-handling check fails even if the
   application hides its own logs.
9. Return code from the predicted CREATE2 address that is interface-compatible but runtime/configuration-wrong; reject
   `already deployed` adoption.
10. Make every semantic check pass except the receipt/runtime/configuration readback; deployment verification remains
    incomplete and activation stays blocked.
