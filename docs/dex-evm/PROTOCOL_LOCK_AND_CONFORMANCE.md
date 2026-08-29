# Protocol lock and conformance

## Exact lock

| Field | Locked value |
| --- | --- |
| Protocol commit | `334bb26703a4dab18ce0fca8485c6275a879933a` |
| Protocol tree | `a0c4d7018eb810c35ac11cdd4e066cd92a6ee513` |
| Specification | `programmable-protocol/0.1.0-draft.1` |
| Constitution | `sha256:2715d9770de7b327c054c413a99f7cbba0933f2eabc9639a53948706237cd301` |
| Portable vector set | `sha256:d61a757f8d4c14d3e5ab0f92e77ab39bd54e7a91f4cc5d591819c58768481137` |
| Status | `draft` |
| Production eligible | `false` |

The lock uses exact-commit-only resolution. A moving branch or tag is not an
equivalent source.

## What was verified

The read-only Protocol checkout matched the commit and tree and was clean. Its
official `make check` passed for 70 files, 12 schemas, 10 example fixtures, 8
Market templates, 221 portable vector cases, 175 normative requirements and 16
local links. The inventory contained zero Binding Releases and zero Conformance
Reports. See the
[verification record](../../packages/dex-evm/binding/reports/protocol-lock-verification.json).

That check establishes internal consistency of the locked Protocol repository.
It does not establish an EVM implementation claim.

The [requirement traceability status](../../packages/dex-evm/binding/reports/requirement-traceability.json)
maps only named foundation claims to source, test-source and generated-evidence
paths, and maps every recorded blocker to exact requirement IDs. It explicitly
does not claim 175-of-175 implementation coverage, test execution or conformance.

## Why conformance is unavailable

The [release-coordinator report](../../packages/dex-evm/binding/reports/protocol-gap-report.json)
records twelve independent counterexamples, including missing Refund grammar,
incomplete capability/source commitments, ambiguous stored-Scope limits,
proposer-supplied occurrence IDs, missing Asset Move endpoint classes,
unobservable async-deficit provenance, incomplete Receipt relationships,
required-profile/vector defects, a vacuous exit profile, an undefined portable
Scope/native-signature bridge and ambiguous return-only transcript accounting.

Choosing an EVM-specific answer would create a new Protocol rather than conform
to this lock. Therefore this repository does not publish a Binding Release or
Conformance Report, and it does not classify the baseline as a testnet candidate.

## Separate eligibility gate

Even if native tests passed, the locked `draft` and
`production_eligible=false` inventory independently prohibits Production. The
release-eligibility gate is recorded separately from the twelve ambiguity IDs
so passing one class cannot hide the other.

## Resolution protocol

The portable Protocol coordinator must resolve the exact cited requirements and
release applicable vectors. After that, update the lock to a reviewed exact
commit, rebuild the native mapping without retaining locally invented semantics,
and run a complete strict conformance procedure. Historical blocked records must
remain immutable evidence of the prior lock.
